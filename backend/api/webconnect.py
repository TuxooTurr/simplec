"""
Веб-коннекторы и анализатор логов.

Коннектор — ресурс (адрес) и способ входа: вручную (SSO) или логин и пароль техучётки
(пароль хранится зашифрованным, форма входа берётся из записи).
Операция (в коде — scenario) — записанное действие в виде шаблона с параметрами:
повтор запроса сайта, логи OpenShift или повтор шагов (ввести, нажать, забрать текст).
Анализатор логов запускает операцию-источник по имени микросервиса и разбирает ошибки.

  GET    /api/webconnect                                   — коннекторы и сценарии
  POST   /api/webconnect/connectors                        — создать / изменить коннектор
  DELETE /api/webconnect/connectors/{cid}                  — удалить (вместе со сценариями)
  POST   /api/webconnect/connectors/{cid}/window           — открыть окно: mode=login | record
  GET    /api/webconnect/connectors/{cid}/window           — что записано на данный момент
  POST   /api/webconnect/connectors/{cid}/window/close     — закрыть окно (запись сохраняется)
  GET    /api/webconnect/connectors/{cid}/recording        — последняя запись
  POST   /api/webconnect/connectors/{cid}/draft            — черновик сценария из выбранного ответа
  POST   /api/webconnect/scenarios                         — сохранить сценарий
  DELETE /api/webconnect/scenarios/{sid}
  POST   /api/webconnect/scenarios/{sid}/run               — запустить: values (параметры) + minutes

  GET    /api/log-analyzer                                 — сохранённые сервисы и источник
  POST   /api/log-analyzer/services                        — сохранить имя сервиса
  DELETE /api/log-analyzer/services/{name}
  POST   /api/log-analyzer/run                             — разобрать логи сервиса за N минут
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from webconnect.browser import NeedLogin, WebError, windows
from webconnect.runner import run_operation
from webconnect.secrets import encrypt
from webconnect.store import WebStore
from webconnect.templates import (
    PARAM_NAME_RE, detect_login, template_params, templatize, templatize_steps, uses_window,
)

router = APIRouter()


def _require_superuser(request: Request) -> None:
    user = getattr(request.state, "user", None)
    if user and user.get("role") != "superuser":
        raise HTTPException(403, "Настраивать веб-коннекторы может только суперюзер")


def _connector(cid: str) -> dict:
    c = WebStore.connector(cid)
    if not c:
        raise HTTPException(404, "Коннектор не найден")
    return c


def _web_error(e: Exception) -> HTTPException:
    return HTTPException(409 if isinstance(e, NeedLogin) else 502,
                         {"message": str(e), "need_login": isinstance(e, NeedLogin)})


# ── Коннекторы ───────────────────────────────────────────────────────────────

class ConnectorBody(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=100)
    base_url: str = Field(..., pattern=r"^https?://")
    notes: str = ""
    auth_mode: Literal["manual", "password"] = "manual"
    login: str = Field("", max_length=200)
    # Пароль только записывается: пустое значение — оставить сохранённый.
    password: str = Field("", max_length=500)


def _public(c: dict) -> dict:
    """Коннектор для интерфейса: без зашифрованного пароля, с признаком «пароль сохранён»."""
    auth = dict(c.get("auth") or {"mode": "manual"})
    auth["has_password"] = bool(auth.pop("password_enc", ""))
    w = windows.existing(c["id"])
    human = bool(w and w.is_open and w.mode in ("login", "record"))
    return {**c, "auth": auth, "window": {"open": human, "mode": w.mode if human else ""}}


@router.get("/api/webconnect")
def list_all() -> dict:
    return {"connectors": [_public(c) for c in WebStore.connectors()], "scenarios": WebStore.scenarios()}


@router.post("/api/webconnect/connectors")
def save_connector(body: ConnectorBody, request: Request) -> dict:
    _require_superuser(request)
    old = WebStore.connector(body.id) if body.id else None
    auth = dict((old or {}).get("auth") or {})
    auth["mode"] = body.auth_mode
    auth["login"] = body.login.strip()
    if body.password:
        auth["password_enc"] = encrypt(body.password)
    if body.auth_mode == "manual":
        auth.pop("password_enc", None)      # ручной вход — пароль больше не нужен, не храним
    item = {k: v for k, v in body.model_dump(exclude_none=True).items() if k not in ("auth_mode", "login", "password")}
    item["auth"] = auth
    return _public(WebStore.save_connector(item))


@router.delete("/api/webconnect/connectors/{cid}")
async def delete_connector(cid: str, request: Request) -> dict:
    _require_superuser(request)
    w = windows.existing(cid)
    if w:
        await w.close()
    if not WebStore.delete_connector(cid):
        raise HTTPException(404, "Коннектор не найден")
    return {"status": "deleted"}


# ── Окно: вход и запись ──────────────────────────────────────────────────────

class WindowBody(BaseModel):
    mode: Literal["login", "record"] = "record"


@router.post("/api/webconnect/connectors/{cid}/window")
async def open_window(cid: str, body: WindowBody, request: Request) -> dict:
    _require_superuser(request)
    c = _connector(cid)
    w = windows.get(c)
    if w.lock.locked():
        raise HTTPException(409, "Сценарий этого коннектора сейчас выполняется — подождите.")
    try:
        await w.open(headless=False, record=body.mode == "record", mode=body.mode)
        await w.goto(c["base_url"])
    except WebError as e:
        raise _web_error(e)
    except Exception as e:
        await w.close()
        raise HTTPException(502, {"message": f"Не удалось открыть {c['base_url']}: {e}", "need_login": False})
    return w.snapshot()


@router.get("/api/webconnect/connectors/{cid}/window")
def window_status(cid: str) -> dict:
    _connector(cid)
    w = windows.existing(cid)
    if not w:
        return {"mode": "", "open": False, "seconds": 0, "steps": [], "responses": []}
    snap = w.snapshot()
    snap["open"] = w.is_open
    return snap


def _candidates(snapshot: dict) -> list[dict]:
    """Ответы, похожие на источник данных, — сверху."""
    return sorted(snapshot["responses"], key=lambda r: (-r.get("likeness", 0), -r.get("size", 0)))


@router.post("/api/webconnect/connectors/{cid}/window/close")
async def close_window(cid: str) -> dict:
    c = _connector(cid)
    w = windows.existing(cid)
    if not w:
        return {"saved": False}
    was_record = w.mode == "record"
    full = w.snapshot(with_bodies=True)
    started = w.started_at
    await w.close()
    if not was_record:
        return {"saved": False}
    recording = {
        "connector_id": c["id"],
        "started_at": datetime.fromtimestamp(started, tz=timezone.utc).isoformat() if started else None,
        "steps": full["steps"],
        "responses": full["responses"],
    }
    WebStore.save_recording(c["id"], recording)
    # Вход был в записи — запоминаем форму входа: пригодится для входа по логину и паролю.
    login = detect_login(full["steps"])
    if login:
        auth = dict(c.get("auth") or {"mode": "manual"})
        auth["recipe"] = login
        WebStore.save_connector({"id": c["id"], "auth": auth})
    return {"saved": True, "login_detected": bool(login), **_recording_view(recording)}


def _recording_view(rec: dict) -> dict:
    login = detect_login(rec["steps"])
    return {
        "started_at": rec.get("started_at"),
        "login_end": login["end_index"] if login else 0,
        "steps": rec["steps"],
        "responses": [{**{k: v for k, v in r.items() if k != "body"}, "preview": (r.get("body") or "")[:600]}
                      for r in sorted(rec["responses"], key=lambda r: (-r.get("likeness", 0), -r.get("size", 0)))],
    }


@router.get("/api/webconnect/connectors/{cid}/recording")
def last_recording(cid: str) -> dict:
    _connector(cid)
    rec = WebStore.recording(cid)
    if not rec:
        raise HTTPException(404, "Записи ещё нет")
    return _recording_view(rec)


# ── Черновик и сценарии ──────────────────────────────────────────────────────

class ParamIn(BaseModel):
    name: str
    label: str = ""
    value: str = ""


class DraftBody(BaseModel):
    mode: Literal["request", "steps"] = "request"
    response_id: Optional[int] = None
    params: list[ParamIn] = Field(default_factory=list)
    start_index: Optional[int] = None
    service_value: str = ""          # старый вариант: один параметр «сервис»


def _param_values(body: "DraftBody") -> dict[str, str]:
    params = list(body.params)
    if not params and body.service_value.strip():
        params = [ParamIn(name="service", label="Сервис", value=body.service_value)]
    for p in params:
        if not PARAM_NAME_RE.match(p.name):
            raise HTTPException(422, f"Имя параметра «{p.name}»: латиница в нижнем регистре, цифры и _, с буквы")
    return {p.name: p.value for p in params if p.value.strip()}


def _download_source(download: dict, responses: list[dict]) -> Optional[dict]:
    """Выгрузку часто собирает сам браузер из уже полученного ответа — ищем этот ответ."""
    probes = [l.strip() for l in (download.get("body") or "").splitlines() if len(l.strip()) > 20][:3]
    for r in sorted(responses, key=lambda r: -r.get("likeness", 0)):
        if r["kind"] == "response" and probes and all(p in (r.get("body") or "") for p in probes):
            return r
    return None


@router.post("/api/webconnect/connectors/{cid}/draft")
def make_draft(cid: str, body: DraftBody) -> dict:
    _connector(cid)
    rec = WebStore.recording(cid)
    if not rec:
        raise HTTPException(404, "Сначала запишите действия")
    values = _param_values(body)

    if body.mode == "steps":
        login = detect_login(rec["steps"])
        start = body.start_index if body.start_index is not None else (login["end_index"] if login else 0)
        tpl = templatize_steps(rec["steps"], values, start)
        warnings = [f"«{v}» не найдено в шагах — параметр «{n}» подставляться не будет."
                    for n, v in values.items() if not tpl["found"].get(n)]
        if not tpl["steps"]:
            warnings.append("После выбранного шага нет действий — операция только откроет страницу.")
        return {"template": tpl, "note": "", "warnings": warnings, "steps": rec["steps"], "start_index": start}

    chosen = next((r for r in rec["responses"] if r["id"] == body.response_id), None)
    if not chosen:
        raise HTTPException(404, "Такого ответа в записи нет")
    note = ""
    if chosen["kind"] == "download":
        if chosen["url"].startswith(("blob:", "data:")):
            src = _download_source(chosen, rec["responses"])
            if not src:
                raise HTTPException(422, "Файл собран в браузере, и запрос-источник не найден — выберите в списке "
                                         "запрос, которым страница получила эти логи.")
            note = f"Файл «{chosen.get('filename', '')}» собран из ответа {src['method']} {src['url'].split('?')[0]} — повторяем его."
            chosen = src
    recorded_at = None
    if rec.get("started_at"):
        recorded_at = datetime.fromisoformat(rec["started_at"]) + timedelta(seconds=chosen.get("t", 0))
    tpl = templatize({"method": chosen["method"], "url": chosen["url"], "body": chosen.get("post_data"),
                      "headers": chosen.get("request_headers") or {}}, values, recorded_at)
    warnings = []
    if tpl["kind"] == "request":
        warnings += [f"«{v}» не найдено в запросе — параметр «{n}» подставляться не будет."
                     for n, v in values.items() if not tpl["found"].get(n)]
    if tpl["kind"] == "request" and not tpl["found"]["time"]:
        warnings.append("В запросе нет окна времени — ресурс сам решает, за какой период отдать данные.")
    return {"template": tpl, "note": note, "warnings": warnings, "steps": rec["steps"]}


class ParamDef(BaseModel):
    name: str
    label: str = ""
    default: str = ""


class ScenarioBody(BaseModel):
    id: Optional[str] = None
    connector_id: str
    name: str = Field(..., min_length=1, max_length=120)
    template: dict
    params: list[ParamDef] = Field(default_factory=list)
    output: Literal["logs", "data", "text"] = "logs"
    extract_selector: str = ""
    steps: list[dict] = Field(default_factory=list)     # записанные шаги — для справки
    log_source: bool = False


@router.post("/api/webconnect/scenarios")
def save_scenario(body: ScenarioBody, request: Request) -> dict:
    _require_superuser(request)
    _connector(body.connector_id)
    tpl = body.template
    if tpl.get("kind") not in ("request", "k8s_logs", "steps"):
        raise HTTPException(422, "Неизвестный вид операции")
    for p in body.params:
        if not PARAM_NAME_RE.match(p.name):
            raise HTTPException(422, f"Имя параметра «{p.name}»: латиница в нижнем регистре, цифры и _, с буквы")
    params = [p.model_dump() for p in body.params]
    # Параметр есть в шаблоне, но не описан — добавляем сами, чтобы он не потерялся при запуске.
    known = {p["name"] for p in params}
    params += [p for p in template_params(tpl) if p["name"] not in known]
    if tpl["kind"] == "k8s_logs" and not params:
        params = [{"name": "service", "label": "Сервис", "default": ""}]
    item = {"id": body.id, "connector_id": body.connector_id, "name": body.name, "kind": tpl["kind"],
            "params": params, "output": "logs" if tpl["kind"] == "k8s_logs" else body.output,
            "recorded_steps": body.steps, "log_source": body.log_source}
    if tpl["kind"] == "k8s_logs":
        item.update({"namespace": tpl["namespace"], "container": tpl.get("container", ""), "window": True})
    elif tpl["kind"] == "steps":
        item.update({"start_url": tpl.get("start_url", ""), "steps": tpl.get("steps", []),
                     "extract_selector": body.extract_selector.strip(),
                     "window": uses_window(tpl.get("start_url"), *(s.get("value") for s in tpl.get("steps", [])))})
    else:
        item["request"] = {k: tpl.get(k) for k in ("method", "url", "body", "headers")}
        item["window"] = uses_window(tpl.get("url"), tpl.get("body"))
    return WebStore.save_scenario({k: v for k, v in item.items() if v is not None})


@router.delete("/api/webconnect/scenarios/{sid}")
def delete_scenario(sid: str, request: Request) -> dict:
    _require_superuser(request)
    if not WebStore.delete_scenario(sid):
        raise HTTPException(404, "Сценарий не найден")
    return {"status": "deleted"}


class RunBody(BaseModel):
    values: dict[str, str] = Field(default_factory=dict)
    service: str = Field("", max_length=200)          # старый вариант
    minutes: int = Field(10, ge=1, le=24 * 60)


def op_params(op: dict) -> list[dict]:
    """Параметры операции. У старых операций параметр один — {service}, если он есть в шаблоне."""
    if op.get("params") is not None:
        return op["params"]
    tpl = json.dumps(op.get("request") or {}, ensure_ascii=False)
    return [{"name": "service", "label": "Сервис", "default": ""}] if "{service}" in tpl or op["kind"] == "k8s_logs" else []


async def _run(scenario: dict, values: dict[str, str], minutes: int) -> dict:
    c = _connector(scenario["connector_id"])
    w = windows.get(c)
    if w.is_open and w.mode in ("login", "record"):
        raise HTTPException(409, {"message": "Открыто окно входа или записи этого коннектора — закройте его.",
                                  "need_login": False})
    # Незаполненный параметр — значение по умолчанию (то, что вводили при записи).
    filled = {p["name"]: (values.get(p["name"]) or "").strip() or p.get("default", "") for p in op_params(scenario)}
    missing = [p.get("label") or p["name"] for p in op_params(scenario) if not filled.get(p["name"])]
    if missing:
        raise HTTPException(422, {"message": f"Заполните: {', '.join(missing)}", "need_login": False})
    try:
        result = await run_operation(w, scenario, filled, minutes)
    except WebError as e:
        raise _web_error(e)
    result["scenario"] = {"id": scenario["id"], "name": scenario["name"], "connector": c["name"]}
    return result


@router.post("/api/webconnect/scenarios/{sid}/run")
async def run(sid: str, body: RunBody) -> dict:
    sc = WebStore.scenario(sid)
    if not sc:
        raise HTTPException(404, "Операция не найдена")
    values = dict(body.values)
    if body.service and "service" not in values:
        values["service"] = body.service
    return await _run(sc, values, body.minutes)


# ── Анализатор логов ─────────────────────────────────────────────────────────

class ServiceBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    note: str = ""


@router.get("/api/log-analyzer")
def analyzer_state() -> dict:
    src = WebStore.log_source()
    connector = WebStore.connector(src["connector_id"]) if src else None
    return {
        "services": WebStore.services(),
        "source": {"id": src["id"], "name": src["name"], "kind": src["kind"],
                   "connector": connector["name"] if connector else ""} if src else None,
    }


@router.post("/api/log-analyzer/services")
def add_service(body: ServiceBody) -> dict:
    return {"services": WebStore.save_service(body.name, body.note)}


@router.delete("/api/log-analyzer/services/{name}")
def remove_service(name: str) -> dict:
    return {"services": WebStore.delete_service(name)}


class AnalyzeBody(BaseModel):
    service: str = Field(..., min_length=1, max_length=200)
    minutes: int = Field(10, ge=1, le=24 * 60)


@router.post("/api/log-analyzer/run")
async def analyze(body: AnalyzeBody) -> dict:
    src = WebStore.log_source()
    if not src:
        raise HTTPException(422, {"message": "Источник логов не настроен: в «Генераторы событий → Веб-коннекторы» "
                                             "запишите сценарий выгрузки логов и отметьте «Источник для анализатора».",
                                  "need_login": False})
    params = op_params(src)
    # Сервис подставляется в параметр «service», а если его нет — в первый параметр операции.
    name = "service" if any(p["name"] == "service" for p in params) else (params[0]["name"] if params else "service")
    return await _run(src, {name: body.service}, body.minutes)
