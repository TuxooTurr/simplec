"""
WebSocket стриминг генерации + REST парсинг файлов.

WebSocket протокол:
  Client → Server:
    {"action": "start",  "requirement": "...", "feature": "...", "depth": "smoke", "provider": "gigachat"}
    {"action": "export", "cases": [...], "qa_doc": "...", "project": "...", ...}

  Server → Client:
    {"type": "layer_start",     "layer": 1, "name": "QA документация"}
    {"type": "layer_done",      "layer": 1, "elapsed": 42, "data": {"qa_doc": "..."}}
    {"type": "layer_start",     "layer": 2, "name": "Список кейсов"}
    {"type": "layer_done",      "layer": 2, "elapsed": 68, "data": {"count": 8, "cases": [...]}}
    {"type": "case_start",      "i": 1, "total": 8, "name": "..."}
    {"type": "case_done",       "i": 1, "case": {...}}
    {"type": "generation_done", "elapsed": 180, "qa_doc": "...", "cases": [...]}
    {"type": "export_done",     "xml": "...", "csv": "...", "md": "..."}
    {"type": "error",           "message": "..."}
"""

import asyncio
import csv
import io
import time
from typing import List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException

router = APIRouter()


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

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
    """Конвертирует TestCaseMarkdown в JSON-сериализуемый dict."""
    return {
        "name": tc.name,
        "priority": tc.priority,
        "case_type": tc.case_type,
        "steps": tc.steps,
    }


def _dict_to_tc(d: dict):
    """Конвертирует dict обратно в TestCaseMarkdown."""
    from agents.layered_generator import TestCaseMarkdown
    return TestCaseMarkdown(
        name=d["name"],
        steps=d.get("steps", []),
        priority=d.get("priority", "Normal"),
        case_type=d.get("case_type", "positive"),
    )


# ──────────────────────────────────────────────────────────────────────────────
# WebSocket handler
# ──────────────────────────────────────────────────────────────────────────────

async def _handle_generation(ws: WebSocket, data: dict):
    requirement = data.get("requirement", "")
    feature = data.get("feature", "Feature")
    depth = data.get("depth", "smoke")
    provider = data.get("provider", "gigachat")

    if not requirement:
        await ws.send_json({"type": "error", "message": "Требование не может быть пустым"})
        return

    t_start = time.time()
    try:
        from agents.llm_client import LLMClient
        from agents.layered_generator import LayeredGenerator

        llm = LLMClient(provider=provider)
        gen = LayeredGenerator(llm)

        # Layer 1 — QA doc
        await ws.send_json({"type": "layer_start", "layer": 1, "name": "QA документация"})
        qa_doc = await asyncio.to_thread(gen.generate_qa_doc, requirement, feature)
        t1 = round(time.time() - t_start)
        await ws.send_json({
            "type": "layer_done", "layer": 1, "elapsed": t1,
            "data": {"qa_doc": qa_doc},
        })

        # Layer 2 — Case list
        await ws.send_json({"type": "layer_start", "layer": 2, "name": "Список кейсов"})
        case_list = await asyncio.to_thread(gen.generate_case_list, qa_doc, depth, "", feature)
        t2 = round(time.time() - t_start)
        await ws.send_json({
            "type": "layer_done", "layer": 2, "elapsed": t2,
            "data": {"count": len(case_list), "cases": case_list},
        })

        # Layer 3 — Detailed cases
        total = len(case_list)
        all_cases = []
        for i, case_info in enumerate(case_list):
            case_name = case_info.get("name", "")[:60]
            await ws.send_json({"type": "case_start", "i": i + 1, "total": total, "name": case_name})

            tc = await asyncio.to_thread(gen.generate_case_markdown, case_info, qa_doc, depth)
            case_dict = _tc_to_dict(tc)
            all_cases.append(case_dict)

            await ws.send_json({"type": "case_done", "i": i + 1, "case": case_dict})

        t3 = round(time.time() - t_start)
        await ws.send_json({
            "type": "generation_done",
            "elapsed": t3,
            "qa_doc": qa_doc,
            "cases": all_cases,
        })

    except Exception as e:
        await ws.send_json({"type": "error", "message": str(e)})


async def _handle_export(ws: WebSocket, data: dict):
    cases_raw = data.get("cases", [])
    qa_doc = data.get("qa_doc", "")
    project = data.get("project", "SBER911")
    system = data.get("system", "")
    team = data.get("team", "")
    domain = data.get("domain", "")
    folder = data.get("folder", "Новая ТМ")
    use_llm = data.get("use_llm", False)
    provider = data.get("provider", "gigachat")

    try:
        cases = [_dict_to_tc(c) for c in cases_raw]

        from agents.layered_generator import LayeredGenerator

        if use_llm:
            from agents.llm_client import LLMClient
            llm = LLMClient(provider=provider)
            gen = LayeredGenerator(llm)
            xml_content = await asyncio.to_thread(
                gen.wrap_all_cases_via_llm,
                cases, qa_doc, project, system, team, domain, folder
            )
        else:
            gen = LayeredGenerator(None)
            xml_content = gen.cases_to_xml(cases, project, system, team, domain, folder)

        csv_content = await asyncio.to_thread(_cases_to_csv, cases)
        md_content = _cases_to_md(cases, qa_doc)

        await ws.send_json({
            "type": "export_done",
            "xml": xml_content,
            "csv": csv_content,
            "md": md_content,
        })
    except Exception as e:
        await ws.send_json({"type": "error", "message": str(e)})


@router.websocket("/api/ws/generation")
async def ws_generation(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            if action == "start":
                await _handle_generation(websocket, data)
            elif action == "export":
                await _handle_export(websocket, data)
            else:
                await websocket.send_json({"type": "error", "message": f"Unknown action: {action}"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────────────────────
# REST: file → text
# ──────────────────────────────────────────────────────────────────────────────

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
        raise HTTPException(status_code=500, detail=str(e))
