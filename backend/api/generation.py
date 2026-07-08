"""
WebSocket стриминг генерации + REST API сессий.

Генерация запускается как asyncio.Task и продолжает работу даже при
отключении WebSocket. Результаты сохраняются в data/gen_sessions.json.

WebSocket протокол:
  Client → Server:
    {"action": "start",  "requirement": "...", "feature": "...", "depth": "smoke", "provider": "...", "platform": "Web"}
    {"action": "attach", "session_id": "..."}
    {"action": "export", "cases": [...], "qa_doc": "...", "project": "...", ...}
    {"action": "export_session", "session_id": "...", "project": "...", ...}

  Server → Client:
    {"type": "session_created",   "session_id": "..."}
    {"type": "session_state",     "session_id": "...", ...}
    {"type": "layer_start",       "layer": 1, "name": "QA документация"}
    {"type": "layer_done",        "layer": 1, "elapsed": 42, "data": {...}}
    {"type": "case_start",        "i": 1, "total": 8, "name": "..."}
    {"type": "case_done",         "i": 1, "case": {...}}
    {"type": "generation_done",   "elapsed": 180, "qa_doc": "...", "cases": [...]}
    {"type": "export_done",       "xml": "...", "csv": "...", "md": "..."}
    {"type": "error",             "message": "..."}

REST:
  GET    /api/generation/sessions              — список сессий
  GET    /api/generation/sessions/{id}         — полная сессия
  DELETE /api/generation/sessions/{id}         — удалить сессию
  POST   /api/generation/sessions/{id}/resume  — возобновить после ошибки
  POST   /api/generation/sessions/{id}/export  — экспорт сессии
  POST   /api/generation/parse-file            — распарсить файл
"""

import asyncio
import csv
import io
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from pydantic import BaseModel

from db.gen_sessions_store import GenSessionsStore

router = APIRouter()

# ── In-memory registry ──────────────────────────────────────────────────────

_active_tasks: dict[str, asyncio.Task] = {}
_active_ws: dict[str, WebSocket] = {}


def _classify_error(e: Exception) -> tuple[bool, str]:
    from agents.llm_client import LLMClient
    return LLMClient.classify_error(e)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _cases_to_csv(cases: list) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Название", "Приоритет", "Тип", "Шаг №", "Действие", "Данные", "UI", "API", "БД"])
    for case in cases:
        steps = case.get("steps", []) if isinstance(case, dict) else case.steps
        name = case.get("name", "") if isinstance(case, dict) else case.name
        prio = case.get("priority", "Normal") if isinstance(case, dict) else case.priority
        ctype = case.get("case_type", "positive") if isinstance(case, dict) else case.case_type
        for i, step in enumerate(steps):
            s = step if isinstance(step, dict) else step.__dict__
            writer.writerow([
                name if i == 0 else "",
                prio if i == 0 else "",
                ctype if i == 0 else "",
                i + 1,
                s.get("action", ""),
                s.get("test_data", ""),
                s.get("ui", ""),
                s.get("api", ""),
                s.get("db", ""),
            ])
    return buf.getvalue()


def _cases_to_md(cases: list, qa_doc: str) -> str:
    lines = ["# Тест-кейсы\n"]
    if qa_doc:
        lines += ["## QA Документация\n", qa_doc, "\n---\n"]
    lines.append("## Тест-кейсы\n")
    for i, case in enumerate(cases, 1):
        name = case.get("name", "") if isinstance(case, dict) else case.name
        prio = case.get("priority", "Normal") if isinstance(case, dict) else case.priority
        ctype = case.get("case_type", "positive") if isinstance(case, dict) else case.case_type
        steps = case.get("steps", []) if isinstance(case, dict) else case.steps
        lines.append(f"### {i}. {name}")
        lines.append(f"**Приоритет:** {prio} | **Тип:** {ctype}\n")
        for j, step in enumerate(steps, 1):
            s = step if isinstance(step, dict) else step.__dict__
            lines.append(f"**Шаг {j}:** {s.get('action', '')}")
            lines.append(f"- Данные: {s.get('test_data', '-')}")
            lines.append(f"- UI: {s.get('ui', '-')}")
            lines.append(f"- API: {s.get('api', '-')}")
            lines.append(f"- БД: {s.get('db', '-')}\n")
        lines.append("")
    return "\n".join(lines)


def _tc_to_dict(tc) -> dict:
    return {
        "name": tc.name,
        "priority": tc.priority,
        "case_type": tc.case_type,
        "steps": tc.steps,
        "estimated_minutes": tc.estimated_minutes,
    }


def _dict_to_tc(d: dict):
    from agents.layered_generator import TestCaseMarkdown
    return TestCaseMarkdown(
        name=d["name"],
        steps=d.get("steps", []),
        priority=d.get("priority", "Normal"),
        case_type=d.get("case_type", "positive"),
        estimated_minutes=d.get("estimated_minutes", 5),
    )


# ── WS notify (fire-and-forget, safe if disconnected) ──────────────────────

async def _notify(session_id: str, msg: dict):
    ws = _active_ws.get(session_id)
    if not ws:
        return
    try:
        await ws.send_json(msg)
    except Exception:
        _active_ws.pop(session_id, None)


# ── Core generation task ────────────────────────────────────────────────────

async def _run_generation(session_id: str):
    """
    Основная логика генерации. Запускается как asyncio.Task.
    Сохраняет прогресс в GenSessionsStore после каждого шага.
    Отправляет WS-события если клиент подключён.
    """
    store = GenSessionsStore
    session = store.get_session(session_id)
    if not session:
        return

    requirement = session["requirement"]
    feature = session["feature"]
    provider = session["provider"]

    t_start = time.time()

    try:
        from agents.prompt_guard import sanitize_input
        from agents.llm_client import LLMClient
        from agents.layered_generator import LayeredGenerator

        llm = LLMClient(provider=provider)
        gen = LayeredGenerator(llm)

        # Context docs from vector store
        context_docs_text = ""
        try:
            from db.vector_store import VectorStore
            vs = VectorStore()
            similar = vs.find_similar_context_docs(requirement, n_results=5)
            if similar:
                parts = []
                for doc in similar:
                    name = doc.get("metadata", {}).get("name", "")
                    text = doc.get("document", "")
                    if text:
                        header = f"[{name}]" if name else "[Документ]"
                        parts.append(f"{header}\n{text[:3000]}")
                context_docs_text = "\n\n---\n\n".join(parts)
        except Exception:
            pass

        qa_doc = session.get("qa_doc") or ""
        case_list = session.get("case_list") or []
        existing_cases = session.get("cases") or []

        # ── Layer 1: QA doc ─────────────────────────────────────────
        if not qa_doc:
            await _notify(session_id, {"type": "layer_start", "layer": 1, "name": "QA документация"})
            store.update_session(session_id, current_layer=1, status="generating")

            qa_doc = await asyncio.to_thread(
                gen.generate_qa_doc, requirement, feature, context_docs_text
            )
            t1 = round(time.time() - t_start)

            store.update_session(session_id, qa_doc=qa_doc)
            await _notify(session_id, {
                "type": "layer_done", "layer": 1, "elapsed": t1,
                "data": {"qa_doc": qa_doc},
            })

        # ── Layer 2: Case list ──────────────────────────────────────
        if not case_list:
            await _notify(session_id, {"type": "layer_start", "layer": 2, "name": "Список кейсов"})
            store.update_session(session_id, current_layer=2)

            case_list = await asyncio.to_thread(
                gen.generate_case_list, qa_doc, "", feature
            )
            t2 = round(time.time() - t_start)

            store.update_session(session_id, case_list=case_list)
            await _notify(session_id, {
                "type": "layer_done", "layer": 2, "elapsed": t2,
                "data": {"count": len(case_list), "cases": case_list},
            })

        # ── Layer 3: Detailed cases ─────────────────────────────────
        store.update_session(session_id, current_layer=3)
        total = len(case_list)
        all_cases = list(existing_cases)
        start_from = len(all_cases)

        for i in range(start_from, total):
            case_info = case_list[i]
            case_name = case_info.get("name", "")[:60]

            progress = {"current": i + 1, "total": total, "name": case_name}
            store.update_session(session_id, layer3_progress=progress)
            await _notify(session_id, {
                "type": "case_start", "i": i + 1, "total": total, "name": case_name,
            })

            tc = await asyncio.to_thread(gen.generate_case_markdown, case_info, qa_doc)
            case_dict = _tc_to_dict(tc)
            all_cases.append(case_dict)

            store.update_session(session_id, cases=all_cases)
            await _notify(session_id, {"type": "case_done", "i": i + 1, "case": case_dict})

        # ── Done ────────────────────────────────────────────────────
        elapsed = round(time.time() - t_start + session.get("elapsed", 0))
        store.update_session(
            session_id,
            status="done",
            elapsed=elapsed,
            cases=all_cases,
            qa_doc=qa_doc,
            current_layer=3,
            layer3_progress=None,
            error=None,
            error_is_llm=False,
        )
        await _notify(session_id, {
            "type": "generation_done",
            "elapsed": elapsed,
            "qa_doc": qa_doc,
            "cases": all_cases,
            "session_id": session_id,
        })

    except asyncio.CancelledError:
        store.update_session(session_id, status="cancelled")
        raise
    except Exception as e:
        is_llm, msg = _classify_error(e)
        elapsed = round(time.time() - t_start + session.get("elapsed", 0))
        store.update_session(
            session_id,
            status="error",
            error=msg,
            error_is_llm=is_llm,
            elapsed=elapsed,
        )
        await _notify(session_id, {"type": "error", "message": msg, "llm_error": is_llm})
    finally:
        _active_tasks.pop(session_id, None)


def _start_generation_task(session_id: str) -> asyncio.Task:
    old = _active_tasks.pop(session_id, None)
    if old and not old.done():
        old.cancel()
    task = asyncio.create_task(_run_generation(session_id))
    _active_tasks[session_id] = task
    return task


# ── Export logic (standalone) ───────────────────────────────────────────────

async def _do_export(cases_raw: list, qa_doc: str, project: str, system: str,
                     team: str, domain: str, folder: str, use_llm: bool,
                     provider: str, crit_regress: bool,
                     project_id: str = "", jira_version: str = "", start_id: Optional[int] = None,
                     author_name: str = "", author_tab_num: str = "") -> dict:
    cases = [_dict_to_tc(c) for c in cases_raw]

    from agents.layered_generator import LayeredGenerator

    if use_llm:
        if not provider:
            raise ValueError("LLM-провайдер не выбран")
        from agents.llm_client import LLMClient
        llm = LLMClient(provider=provider)
        gen = LayeredGenerator(llm)
        xml_content = await asyncio.to_thread(
            gen.wrap_all_cases_via_llm,
            cases, qa_doc, project, system, team, domain, folder, None, crit_regress,
            project_id, jira_version, start_id, author_name, author_tab_num,
        )
    else:
        gen = LayeredGenerator(None)
        xml_content = gen.cases_to_xml(
            cases, project, system, team, domain, folder, crit_regress,
            project_id, jira_version, start_id, author_name, author_tab_num,
        )

    csv_content = await asyncio.to_thread(_cases_to_csv, cases)
    md_content = _cases_to_md(cases, qa_doc)

    return {"xml": xml_content, "csv": csv_content, "md": md_content}


# ── WebSocket handler ───────────────────────────────────────────────────────

async def _handle_ws_start(ws: WebSocket, data: dict):
    from agents.prompt_guard import sanitize_input

    raw_requirement = data.get("requirement", "")
    raw_feature = str(data.get("feature") or "").strip()
    depth = data.get("depth", "max")
    provider = str(data.get("provider") or "").strip()
    platform = data.get("platform", "Web")

    if not raw_requirement:
        await ws.send_json({"type": "error", "message": "Требование не может быть пустым"})
        return
    if not raw_feature:
        await ws.send_json({"type": "error", "message": "Укажите название фичи — оно нужно для имён кейсов"})
        return
    if not provider:
        await ws.send_json({"type": "error", "message": "LLM-провайдер не выбран"})
        return

    req_result = sanitize_input(raw_requirement)
    feat_result = sanitize_input(raw_feature)
    requirement = req_result["text"]
    feature = feat_result["text"]

    if req_result.get("blocked"):
        await ws.send_json({"type": "error", "message": "Входные данные не прошли проверку безопасности"})
        return

    session = GenSessionsStore.create_session({
        "requirement": requirement,
        "feature": feature,
        "depth": depth,
        "provider": provider,
        "platform": platform,
    })
    sid = session["id"]

    _active_ws[sid] = ws
    await ws.send_json({"type": "session_created", "session_id": sid})

    _start_generation_task(sid)


async def _handle_ws_attach(ws: WebSocket, data: dict):
    sid = data.get("session_id", "")
    session = GenSessionsStore.get_session(sid)
    if not session:
        await ws.send_json({"type": "error", "message": f"Сессия '{sid}' не найдена"})
        return

    _active_ws[sid] = ws

    state_msg = {
        "type": "session_state",
        "session_id": sid,
        "status": session["status"],
        "qa_doc": session.get("qa_doc", ""),
        "cases": session.get("cases", []),
        "case_list": session.get("case_list", []),
        "current_layer": session.get("current_layer", 0),
        "layer3_progress": session.get("layer3_progress"),
        "elapsed": session.get("elapsed", 0),
        "error": session.get("error"),
        "error_is_llm": session.get("error_is_llm", False),
        "export_result": session.get("export_result"),
    }
    await ws.send_json(state_msg)


async def _handle_ws_resume(ws: WebSocket, data: dict):
    sid = data.get("session_id", "")
    session = GenSessionsStore.get_session(sid)
    if not session:
        await ws.send_json({"type": "error", "message": f"Сессия '{sid}' не найдена"})
        return

    if session["status"] not in ("error", "cancelled"):
        await ws.send_json({"type": "error", "message": "Можно возобновить только сессию с ошибкой"})
        return

    if sid in _active_tasks and not _active_tasks[sid].done():
        await ws.send_json({"type": "error", "message": "Генерация уже запущена"})
        return

    GenSessionsStore.update_session(sid, status="generating", error=None, error_is_llm=False)
    _active_ws[sid] = ws
    await ws.send_json({"type": "session_created", "session_id": sid})

    _start_generation_task(sid)


async def _handle_ws_export(ws: WebSocket, data: dict):
    cases_raw = data.get("cases", [])
    qa_doc = data.get("qa_doc", "")
    project = data.get("project", "SBER911")
    system = data.get("system", "")
    team = data.get("team", "")
    domain = data.get("domain", "")
    folder = data.get("folder", "Новая ТМ")
    use_llm = data.get("use_llm", False)
    provider = str(data.get("provider") or "").strip()
    crit_regress = data.get("crit_regress", False)
    project_id = data.get("project_id", "")
    jira_version = data.get("jira_version", "")
    start_id = data.get("start_id")
    author_name = data.get("author_name", "")
    author_tab_num = data.get("author_tab_num", "")
    session_id = data.get("session_id")

    try:
        result = await _do_export(
            cases_raw, qa_doc, project, system, team, domain,
            folder, use_llm, provider, crit_regress,
            project_id, jira_version, start_id, author_name, author_tab_num,
        )
        if session_id:
            GenSessionsStore.update_session(session_id, export_result=result)

        await ws.send_json({"type": "export_done", **result})
    except Exception as e:
        is_llm, msg = _classify_error(e)
        await ws.send_json({"type": "error", "message": msg, "llm_error": is_llm})


@router.websocket("/api/ws/generation")
async def ws_generation(websocket: WebSocket):
    await websocket.accept()
    attached_session_ids: set[str] = set()
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            if action == "start":
                await _handle_ws_start(websocket, data)
            elif action == "attach":
                sid = data.get("session_id", "")
                attached_session_ids.add(sid)
                await _handle_ws_attach(websocket, data)
            elif action == "resume":
                await _handle_ws_resume(websocket, data)
            elif action == "export":
                await _handle_ws_export(websocket, data)
            else:
                await websocket.send_json({"type": "error", "message": f"Unknown action: {action}"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            is_llm, msg = _classify_error(e)
            await websocket.send_json({"type": "error", "message": msg, "llm_error": is_llm})
        except Exception:
            pass
    finally:
        for sid in list(_active_ws):
            if _active_ws.get(sid) is websocket:
                _active_ws.pop(sid, None)


# ── REST: sessions ──────────────────────────────────────────────────────────

@router.get("/api/generation/sessions")
def list_sessions(limit: int = 50, status: Optional[str] = None) -> list[dict]:
    return GenSessionsStore.list_sessions(limit=min(limit, 50), status=status)


@router.get("/api/generation/sessions/{session_id}")
def get_session(session_id: str) -> dict:
    session = GenSessionsStore.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    is_running = session_id in _active_tasks and not _active_tasks[session_id].done()
    session["is_running"] = is_running
    return session


@router.delete("/api/generation/sessions/{session_id}")
def delete_session(session_id: str) -> dict:
    task = _active_tasks.pop(session_id, None)
    if task and not task.done():
        task.cancel()
    _active_ws.pop(session_id, None)
    ok = GenSessionsStore.delete_session(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    return {"status": "deleted"}


@router.post("/api/generation/sessions/{session_id}/resume")
async def resume_session(session_id: str) -> dict:
    session = GenSessionsStore.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    if session["status"] not in ("error", "cancelled"):
        raise HTTPException(status_code=400, detail="Можно возобновить только сессию с ошибкой")
    if session_id in _active_tasks and not _active_tasks[session_id].done():
        raise HTTPException(status_code=409, detail="Генерация уже запущена")

    GenSessionsStore.update_session(session_id, status="generating", error=None, error_is_llm=False)
    _start_generation_task(session_id)
    return {"status": "resumed", "session_id": session_id}


class ExportRequest(BaseModel):
    project: str = "SBER911"
    system: str = ""
    team: str = ""
    domain: str = ""
    folder: str = "Новая ТМ"
    use_llm: bool = False
    provider: str = ""
    crit_regress: bool = False
    project_id: str = ""
    jira_version: str = ""
    start_id: Optional[int] = None
    author_name: str = ""
    author_tab_num: str = ""


@router.post("/api/generation/sessions/{session_id}/export")
async def export_session(session_id: str, req: ExportRequest) -> dict:
    session = GenSessionsStore.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    if session["status"] != "done":
        raise HTTPException(status_code=400, detail="Экспорт доступен только для завершённых сессий")

    cases = session.get("cases", [])
    qa_doc = session.get("qa_doc", "")
    if not cases:
        raise HTTPException(status_code=400, detail="Нет кейсов для экспорта")

    try:
        result = await _do_export(
            cases, qa_doc, req.project, req.system, req.team, req.domain,
            req.folder, req.use_llm, req.provider, req.crit_regress,
            req.project_id, req.jira_version, req.start_id, req.author_name, req.author_tab_num,
        )
        GenSessionsStore.update_session(session_id, export_result=result)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        is_llm, msg = _classify_error(e)
        raise HTTPException(status_code=500, detail=msg)


# ── REST: file → text ───────────────────────────────────────────────────────

@router.post("/api/generation/parse-file")
async def parse_file_endpoint(file: UploadFile = File(...)):
    from agents.file_parser import parse_file, validate_file
    data = await file.read()
    try:
        validate_file(data, file.filename)
        text = await asyncio.to_thread(parse_file, data, file.filename)
        return {"text": text, "filename": file.filename, "size": len(data)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Ошибка при парсинге файла")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")
