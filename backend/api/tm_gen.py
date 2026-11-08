"""
Тестовая модель по этапам (методика Sber911-QA): планирование → утверждение человеком → генерация → проверка → правки.

Сессия — та же запись data/gen_sessions.json (GenSessionsStore), с kind="tm": готовую сессию открывает «История»
и выгружает прежний экспорт (cases, qa_doc). Работа идёт фоновой задачей и переживает уход со страницы;
экран опрашивает сессию.

Статусы (свои, чтобы старый экран генерации не принял их за свою «generating»):
  planning → plan_ready (ждёт «Утвердить») → writing → reviewing → review_ready (замечания) → fixing → review_ready …
  → done («Принять»). Ошибка — error (повтор с того же этапа), отмена — cancelled.

REST:
  POST /api/tm/sessions                    — новая сессия, сразу планирование
  GET  /api/tm/sessions/{id}               — сессия целиком
  POST /api/tm/sessions/{id}/approve       — утвердить план (с правками) и ответы → генерация и проверка
  POST /api/tm/sessions/{id}/fix           — исправить отмеченные замечания
  POST /api/tm/sessions/{id}/recheck       — проверить набор ещё раз
  POST /api/tm/sessions/{id}/accept        — принять набор (done)
  POST /api/tm/sessions/{id}/retry         — повторить упавший этап
  POST /api/tm/sessions/{id}/cancel        — остановить
  POST /api/tm/xml                         — готовый XML принятых наборов: по файлу на сессию и общий
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db.gen_sessions_store import GenSessionsStore

logger = logging.getLogger(__name__)
router = APIRouter()

_tasks: dict[str, asyncio.Task] = {}
# Модель зовём по одному запросу за раз: несколько задач в очереди не должны упираться в лимиты GigaChat.
_llm_gate: Optional[asyncio.Semaphore] = None

RUNNING = {"planning", "writing", "reviewing", "fixing"}


def _gate() -> asyncio.Semaphore:
    global _llm_gate
    if _llm_gate is None:
        _llm_gate = asyncio.Semaphore(1)
    return _llm_gate


def _store():
    return GenSessionsStore


def _get(sid: str) -> dict:
    s = _store().get_session(sid)
    if not s or s.get("kind") != "tm":
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    return s


def _llm(provider: str):
    from agents.llm_client import LLMClient
    return LLMClient(provider=provider)


async def _call(fn, *args):
    async with _gate():
        return await asyncio.to_thread(fn, *args)


def _upd(sid: str, **fields):
    return _store().update_session(sid, **fields)


def _launch(sid: str, coro_fn):
    old = _tasks.pop(sid, None)
    if old and not old.done():
        old.cancel()

    async def runner():
        t0 = time.time()
        try:
            await coro_fn(sid)
        except asyncio.CancelledError:
            _upd(sid, status="cancelled", progress=None)
            raise
        except Exception as e:     # noqa: BLE001 — показываем человеку текст ошибки модели или сети
            from agents.llm_client import LLMClient
            is_llm, msg = LLMClient.classify_error(e)
            logger.warning("tm %s: %s", sid, e)
            s = _store().get_session(sid) or {}
            _upd(sid, status="error", error=msg, error_is_llm=is_llm, failed_stage=s.get("status"), progress=None)
        finally:
            s = _store().get_session(sid)
            if s:
                _upd(sid, elapsed=int(s.get("elapsed", 0) + (time.time() - t0)))
            _tasks.pop(sid, None)

    _tasks[sid] = asyncio.create_task(runner())


# ── Этапы ───────────────────────────────────────────────────────────────────

async def _do_plan(sid: str):
    from agents import tm_pipeline as tm
    from db.requirements_store import RequirementsStore
    s = _get(sid)
    _upd(sid, status="planning", error=None, progress=None)
    structure = tm.structure_text(RequirementsStore.list_folders())
    plan = await _call(tm.plan, _llm(s["provider"]), s["requirement"], s["feature"], s.get("platforms", "W"),
                       s.get("place") or [], structure)
    _upd(sid, status="plan_ready", plan=plan)


async def _do_write(sid: str):
    from agents import tm_pipeline as tm
    s = _get(sid)
    plan, answers = s["plan"], s.get("answers") or {}
    llm = _llm(s["provider"])
    rows = plan["scenarios"]
    done = {c.get("plan_id") for c in s.get("cases") or []}
    cases = [c for c in s.get("cases") or [] if c.get("plan_id") in {r["id"] for r in rows}]
    _upd(sid, status="writing", error=None)
    for i, row in enumerate(rows):
        if row["id"] in done:
            continue
        _upd(sid, progress={"current": i + 1, "total": len(rows), "name": row["name"][:80]})
        c = await _call(tm.case, llm, row, plan, s["requirement"], s["feature"], answers)
        cases.append(c)
        order = {r["id"]: k for k, r in enumerate(rows)}
        cases.sort(key=lambda x: order.get(x.get("plan_id"), 999))
        _upd(sid, cases=cases)
    _upd(sid, progress=None)
    await _do_review(sid)


async def _do_review(sid: str):
    from agents import tm_pipeline as tm
    s = _get(sid)
    llm = _llm(s["provider"])
    _upd(sid, status="reviewing", error=None, progress={"current": 1, "total": 2, "name": "Проверка набора"})
    rev = await _call(tm.review, llm, s["requirement"], s["feature"], s["plan"], s.get("cases") or [])
    prev = (s.get("review") or {}).get("remarks") or []
    rev["fixed"] = [r for r in prev if r.get("status") == "fixed"]
    _upd(sid, review=rev)
    if not s.get("qa_doc"):
        _upd(sid, progress={"current": 2, "total": 2, "name": "Документ QA"})
        doc = await _call(tm.qa_doc, llm, s["requirement"], s["feature"])
        _upd(sid, qa_doc=doc)
    _upd(sid, status="review_ready", progress=None)


async def _do_fix(sid: str):
    from agents import tm_pipeline as tm
    s = _get(sid)
    rev = s.get("review") or {}
    picked = [r for r in rev.get("remarks", []) if r.get("status") == "picked"]
    llm = _llm(s["provider"])
    cases = list(s.get("cases") or [])
    _upd(sid, status="fixing", error=None)
    groups: dict[str, list[dict]] = {}
    for r in picked:
        groups.setdefault(r.get("case") or f"__new__{r['id']}", []).append(r)
    for n, (cname, rs) in enumerate(groups.items(), 1):
        _upd(sid, progress={"current": n, "total": len(groups), "name": cname if not cname.startswith("__new__") else "Новый кейс"})
        target = next((c for c in cases if c.get("name") == cname), None)
        new = await _call(tm.fix, llm, target, rs, s["plan"], s["requirement"], s["feature"], s.get("answers") or {})
        if target:
            cases[cases.index(target)] = {**new, "plan_id": target.get("plan_id", "")}
        else:
            cases.append(new)
        ids = {r["id"] for r in rs}
        rev["remarks"] = [{**r, "status": "fixed"} if r["id"] in ids else r for r in rev.get("remarks", [])]
        _upd(sid, cases=cases, review=rev)
    _upd(sid, status="review_ready", progress=None)


# ── API ─────────────────────────────────────────────────────────────────────

class TaskMeta(BaseModel):
    key: str
    summary: str = ""
    project: str = ""
    reqNames: list[str] = []
    dataPath: list[str] = []


class StartBody(BaseModel):
    requirement: str = Field(min_length=1)
    feature: str = Field(min_length=1, max_length=200)
    provider: str = Field(min_length=1)
    platforms: str = "W"
    source: str = "free"                 # free | data | task
    place: list[str] = []                # место в дереве «Данных», если известно (документ, задача)
    task: Optional[TaskMeta] = None
    batch: str = ""                      # очередь по задачам — общая метка


@router.post("/api/tm/sessions")
async def start(body: StartBody) -> dict:
    from agents.prompt_guard import sanitize_input
    req = sanitize_input(body.requirement)
    if req.get("blocked"):
        raise HTTPException(status_code=422, detail="Входные данные не прошли проверку безопасности")
    s = _store().create_session({"requirement": req["text"], "feature": sanitize_input(body.feature)["text"].strip(),
                                 "depth": "tm", "provider": body.provider, "platform": body.platforms})
    s = _upd(s["id"], kind="tm", status="planning", platforms=body.platforms if body.platforms in ("W", "M", "W и M") else "W",
             source=body.source, place=[p.strip() for p in body.place if p.strip()],
             task=body.task.model_dump() if body.task else None, batch=body.batch,
             plan=None, answers={}, review=None, progress=None, failed_stage=None)
    _launch(s["id"], _do_plan)
    return s


@router.get("/api/tm/sessions/{sid}")
def get(sid: str) -> dict:
    s = _get(sid)
    if s.get("status") in RUNNING and sid not in _tasks:
        # бэкенд перезапускался посреди этапа — задача потеряна, предлагаем повтор
        s = _upd(sid, status="error", error="Этап прерван перезапуском сервера — нажмите «Повторить»",
                 failed_stage=s.get("status"), progress=None)
    return s


@router.get("/api/tm/batches/{batch}")
def batch_sessions(batch: str) -> list[dict]:
    out = []
    for summary in _store().list_sessions(limit=50):
        if summary.get("kind") == "tm" and summary.get("batch") == batch:
            out.append(get(summary["id"]))
    return out


class ApproveBody(BaseModel):
    plan: dict
    answers: dict = {}


@router.post("/api/tm/sessions/{sid}/approve")
async def approve(sid: str, body: ApproveBody) -> dict:
    from agents import tm_pipeline as tm
    s = _get(sid)
    if s["status"] != "plan_ready":
        raise HTTPException(status_code=409, detail="План уже утверждён или ещё не готов")
    plan = tm.normalize_plan(body.plan, [p for p in body.plan.get("place", []) if str(p).strip()], s["feature"])
    # строки, которые человек отредактировал, сохраняют свои id — иначе id по порядку
    for i, row in enumerate(plan["scenarios"]):
        src = body.plan.get("scenarios", [])[i] if i < len(body.plan.get("scenarios", [])) else {}
        if isinstance(src, dict) and src.get("id"):
            row["id"] = str(src["id"])
    if not plan["scenarios"]:
        raise HTTPException(status_code=422, detail="В карте нет ни одного кейса")
    s = _upd(sid, plan=plan, answers={str(k): str(v)[:2000] for k, v in body.answers.items()}, cases=[], qa_doc="",
             review=None, place=plan["place"])
    _launch(sid, _do_write)
    return _upd(sid, status="writing")


class FixBody(BaseModel):
    remark_ids: list[str]


@router.post("/api/tm/sessions/{sid}/fix")
async def fix(sid: str, body: FixBody) -> dict:
    s = _get(sid)
    if s["status"] != "review_ready":
        raise HTTPException(status_code=409, detail="Сейчас исправлять нечего")
    rev = s.get("review") or {}
    ids = set(body.remark_ids)
    rev["remarks"] = [{**r, "status": "picked"} if r["id"] in ids and r.get("status") != "fixed" else r for r in rev.get("remarks", [])]
    if not any(r.get("status") == "picked" for r in rev["remarks"]):
        raise HTTPException(status_code=422, detail="Отметьте замечания, которые исправить")
    _upd(sid, review=rev)
    _launch(sid, _do_fix)
    return _upd(sid, status="fixing")


@router.post("/api/tm/sessions/{sid}/recheck")
async def recheck(sid: str) -> dict:
    s = _get(sid)
    if s["status"] not in ("review_ready", "done"):
        raise HTTPException(status_code=409, detail="Проверять пока нечего")
    _launch(sid, _do_review)
    return _upd(sid, status="reviewing")


@router.post("/api/tm/sessions/{sid}/accept")
def accept(sid: str) -> dict:
    s = _get(sid)
    if s["status"] != "review_ready":
        raise HTTPException(status_code=409, detail="Принять можно после проверки")
    return _upd(sid, status="done")


@router.post("/api/tm/sessions/{sid}/retry")
async def retry(sid: str) -> dict:
    s = _get(sid)
    if s["status"] not in ("error", "cancelled"):
        raise HTTPException(status_code=409, detail="Повторять нечего")
    stage = s.get("failed_stage") or "planning"
    if stage == "planning" or not s.get("plan"):
        _launch(sid, _do_plan)
        return _upd(sid, status="planning", error=None)
    if stage == "plan_ready":
        return _upd(sid, status="plan_ready", error=None)
    fn = {"writing": _do_write, "reviewing": _do_review, "fixing": _do_fix}.get(stage, _do_write)
    _launch(sid, fn)
    return _upd(sid, status=stage, error=None)


@router.post("/api/tm/sessions/{sid}/cancel")
def cancel(sid: str) -> dict:
    s = _get(sid)
    t = _tasks.pop(sid, None)
    if t and not t.done():
        t.cancel()
    return _upd(sid, status="cancelled", failed_stage=s.get("status") if s.get("status") in RUNNING else s.get("failed_stage"),
                error="Остановлено", progress=None)


# ── Готовый XML ─────────────────────────────────────────────────────────────

TEAM = "Базовые сервисы (00G10021)"   # команда из вводных методики; АС, домен, крит и папка — у каждого кейса свои
ROOT = "Новая ТМ"


class XmlBody(BaseModel):
    ids: list[str] = Field(min_length=1)
    project: str = "SBER911"
    only: dict[str, list[int]] = {}      # отмеченные кейсы сессии (номера по порядку); нет записи — все


@router.post("/api/tm/xml")
def build_xml(body: XmlBody) -> dict:
    """XML без окна настроек экспорта: всё нужное уже есть в кейсах. Файл на сессию (для предпросмотра в модели
    по задачам) и общий файл на скачивание — кейсы всех сессий подряд, id без повторов."""
    from agents.layered_generator import LayeredGenerator
    from backend.api.generation import _dict_to_tc
    project = (body.project or "SBER911").strip().upper()
    gen = LayeredGenerator(None)
    files, all_cases = [], []
    for sid in body.ids:
        s = _get(sid)
        if s.get("status") != "done":
            raise HTTPException(status_code=409, detail=f"Набор «{s.get('feature')}» ещё не принят")
        raw = s.get("cases") or []
        if sid in body.only:
            keep = set(body.only[sid])
            raw = [c for i, c in enumerate(raw) if i in keep]
        cases = [_dict_to_tc(c) for c in raw]
        if not cases:
            continue
        xml = gen.cases_to_xml(cases, project=project, team=TEAM, folder=ROOT)
        files.append({"id": sid, "feature": s.get("feature", ""), "task": (s.get("task") or {}).get("key", ""), "xml": xml})
        all_cases.extend(cases)
    if not all_cases:
        raise HTTPException(status_code=422, detail="В наборах нет кейсов")
    return {"files": files, "xml": files[0]["xml"] if len(files) == 1 else gen.cases_to_xml(all_cases, project=project, team=TEAM, folder=ROOT)}
