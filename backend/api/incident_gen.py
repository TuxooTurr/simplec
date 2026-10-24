"""
Генератор инцидентов (раздел «Генераторы событий») — тестовые инциденты в Sber911 через интеграционный топик Sber ESM.

Повторяет ноутбук test_incident_pakage_generator.ipynb, но гибко и без его ошибок:
  • инцидент — сообщение Sber ESM в Kafka (по умолчанию repl.sber_esm_input); на каждый CI — N основных и
    случайное число дополнительных (они «раньше» основных на случайные минуты);
  • описание — шаблон с подстановками ({ci}, {system}, {n}, {inc}, {now}) или случайный пример из библиотеки;
    заголовок, тип, приоритет, статус, способ создания, сдвиги времени — параметры;
  • инструкция к основным инцидентам — запись в БД SQL-шаблоном (create_incident_instruction из
    test_sql_templates.json). Нет шаблона или подключения — инциденты уходят без инструкций;
  • у каждого сообщения свой ключ, ошибка отправки — в результате по этому сообщению, а не молча;
  • пресеты (в т.ч. сценарии из test_sc.json), библиотека описаний (из incident_instruction_examples.json —
    без полей о людях), история отправок.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from backend.api.auth import require_superuser
from db import incident_gen_store as store

router = APIRouter(dependencies=[Depends(require_superuser)])

MAX_TOTAL = 500                     # инцидентов за одну отправку


# ── Модели ───────────────────────────────────────────────────────────────────

class Ci(BaseModel):
    code: str = Field(..., min_length=1, max_length=64)
    name: str = ""


class Spec(BaseModel):
    cis: list[Ci] = Field(..., min_length=1, max_length=100)
    main_count: int = Field(1, ge=0, le=50)
    extra_min: int = Field(0, ge=0, le=20)
    extra_max: int = Field(0, ge=0, le=20)
    description_mode: Literal["template", "library"] = "template"
    description: str = "ТЕСТОВЫЙ ИНЦИДЕНТ {n} · {system} ({ci})"
    title: str = ""                                   # шаблон заголовка; пусто — начало описания (255 символов)
    inc_type: str = "AVAILABILITY_INC"
    priority: str = "MEDIUM"
    state: str = "REGISTERED"
    creation_type: str = "MONITORING_SYSTEM"
    potential_vpi: bool = False
    large_scale: bool = False
    impact_custom_service: bool = False
    created_ago_min: int = Field(2, ge=0, le=100_000)
    start_ago_min: int = Field(3, ge=0, le=100_000)
    fact_start_ago_min: int = Field(10, ge=0, le=100_000)
    target_days: int = Field(2, ge=0, le=365)
    extra_spread_min: int = Field(10, ge=0, le=1440)  # дополнительные — раньше основных на 1..N минут
    instruction_mode: Literal["none", "library", "text"] = "none"
    instruction: str = ""


class SettingsBody(BaseModel):
    kafka_connection_id: str = ""
    topic: str = Field(..., min_length=1)
    partition: Optional[int] = Field(0, ge=0, le=1000)
    system_created_by: str = ""
    monitoring_system_name: str = ""
    assignee_id_bhb: str = ""
    assignee_personal_number: str = ""
    db_connection_id: str = ""
    instruction_sql: str = ""
    instruction_wait_sec: int = Field(5, ge=0, le=120)
    instruction_user_id: str = ""
    instruction_user_name: str = ""
    instruction_user_number: str = ""


class LibraryItem(BaseModel):
    system: str = ""
    description: str = Field(..., min_length=1)
    summary: str = ""
    instruction: str = ""


class PresetBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    spec: Spec


# ── Сборка сообщений ─────────────────────────────────────────────────────────

def ts(now: datetime, *deltas: timedelta) -> str:
    """Время как в Sber ESM: 2026-08-27T15:55:01.989151000Z (UTC, наносекунды)."""
    return f"{sum(deltas, now).strftime('%Y-%m-%dT%H:%M:%S.%f')}000Z"


_PH_RE = re.compile(r"\{(ci|system|n|inc|now)\}")


def render(template: str, values: dict[str, str]) -> str:
    """Подстановки {ci} {system} {n} {inc} {now}; остальные фигурные скобки (JSON, код) — как есть."""
    return _PH_RE.sub(lambda m: values[m.group(1)], template)


def inc_number() -> str:
    return f"INC{random.randint(1, 9_999_999_999):010d}"


def plan(spec: Spec, library: list[dict], rng: Optional[random.Random] = None) -> list[dict]:
    """Что отправить: на каждый CI — основные и случайное число дополнительных; описание и инструкция."""
    rng = rng or random.Random()
    if spec.extra_max < spec.extra_min:
        raise HTTPException(422, "Дополнительных «до» меньше, чем «от»")
    need_lib = spec.description_mode == "library" or spec.instruction_mode == "library"
    if need_lib and not library:
        raise HTTPException(422, "Библиотека описаний пуста — добавьте или импортируйте примеры")
    items: list[dict] = []
    for ci in spec.cis:
        extra = rng.randint(spec.extra_min, spec.extra_max)
        for main in [True] * spec.main_count + [False] * extra:
            items.append({"ci": ci.code.strip(), "system": (ci.name or ci.code).strip(), "main": main,
                          "lib": rng.choice(library) if need_lib else None,
                          "shift": 0 if main or not spec.extra_spread_min else -rng.randint(1, spec.extra_spread_min)})
    if not items:
        raise HTTPException(422, "Нечего отправлять: ни основных, ни дополнительных инцидентов")
    if len(items) > MAX_TOTAL:
        raise HTTPException(422, f"За раз — не больше {MAX_TOTAL} инцидентов, сейчас {len(items)}")
    return items


def build(spec: Spec, settings: dict, item: dict, n: int, now: Optional[datetime] = None) -> dict:
    """Сообщение Sber ESM для одного инцидента + то, что нужно для инструкции."""
    now = now or datetime.now(timezone.utc)
    shift = timedelta(minutes=item["shift"])
    inc = inc_number()
    values = {"ci": item["ci"], "system": item["system"], "n": str(n), "inc": inc,
              "now": datetime.now().strftime("%d.%m.%Y %H:%M")}
    lib = item.get("lib") or {}
    description = lib.get("description", "") if spec.description_mode == "library" else render(spec.description, values)
    title = (render(spec.title, values) if spec.title.strip() else description)[:255]
    person = {"idBhb": settings.get("assignee_id_bhb") or None,
              "personalNumber": settings.get("assignee_personal_number") or None, "idEps": None}
    message = {
        "id": str(uuid.uuid4()),
        "businessId": inc,
        "incType": spec.inc_type,
        "potentialVPI": spec.potential_vpi,
        "priorityCode": spec.priority,
        "priorityMethod": "MANUALLY",
        "integrationHubId": None,
        "itService": {"guid": str(uuid.uuid4()), "code": item["ci"]},
        "description": description,
        "reasonINC": None,
        "workGroup": str(uuid.uuid4()),
        "stateCode": spec.state,
        "assignee": person,
        "createdBy": dict(person),
        "largeScale": spec.large_scale,
        "targetDate": ts(now, timedelta(days=spec.target_days), shift),
        "createdAt": ts(now, timedelta(minutes=-spec.created_ago_min), shift),
        "updatedAt": ts(now, shift),
        "closeDate": None,
        "postedBySberESM": ts(now, timedelta(minutes=-spec.created_ago_min), shift),
        "standType": None,
        "systemCreatedBy": settings.get("system_created_by") or None,
        "title": title,
        "impactCustomService": spec.impact_custom_service,
        "configurationElement": None,
        "isAutoHealing": None,
        "resolutionDescription": None,
        "startDate": ts(now, timedelta(minutes=-spec.start_ago_min), shift),
        "finishDate": None,
        "factStartDate": ts(now, timedelta(minutes=-spec.fact_start_ago_min), shift),
        "factFinishDate": None,
        "expired": False,
        "standIn": False,
        "registeredByEventId": False,
        "creationType": spec.creation_type,
    }
    instruction = ""
    if item["main"]:
        instruction = lib.get("instruction", "") if spec.instruction_mode == "library" else (
            render(spec.instruction, values) if spec.instruction_mode == "text" else "")
    return {"ci": item["ci"], "main": item["main"], "message": message, "instruction": instruction,
            "summary": lib.get("summary") or title}


# ── SQL-шаблон инструкции ────────────────────────────────────────────────────

_SQL_PH = re.compile(r"\{(\w+)\}")


def sql_literal(value: Any) -> str:
    """Значение для подстановки в SQL — как в ноутбуке (None → NULL, nextval(...) как есть, список → (a, b)),
    но кавычки внутри строк экранируются: текст инструкции с апострофом не ломает запрос."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, tuple)):
        return "(" + ", ".join(sql_literal(v) for v in value) + ")"
    s = str(value)
    if s.startswith("nextval("):
        return s
    return "'" + s.replace("'", "''") + "'"


def render_sql(template: str, params: dict[str, Any]) -> str:
    """{param} → значение; параметр, которого нет, — NULL (как в ноутбуке: все параметры шаблона заранее None)."""
    return _SQL_PH.sub(lambda m: sql_literal(params.get(m.group(1))), template)


def instruction_params(built: dict, settings: dict) -> dict[str, Any]:
    msg = built["message"]
    uid = (settings.get("instruction_user_id") or "").strip()
    return {
        "instruction_req_uuid": str(uuid.uuid4()),
        "incident_id": None,
        "incident_sm_id": msg["businessId"],
        "incident_short_description": msg["title"],
        "incident_technical_description": msg["description"],
        "incident_summarization": built.get("summary") or msg["title"],
        "incident_instruction": built["instruction"],
        "system_cis": [built["ci"]],
        "sberesm_uuid": msg["id"],
        "monitoring_system_ci": msg["systemCreatedBy"],
        "monitoring_system_name": settings.get("monitoring_system_name") or None,
        "incident_it_npi_update_seq": None,
        "user_id": int(uid) if uid.isdigit() else (uid or None),
        "user_name": settings.get("instruction_user_name") or None,
        "user_employee_number": settings.get("instruction_user_number") or None,
    }


def instructions_ready(settings: dict) -> str:
    """Почему инструкции записать нельзя; пусто — можно."""
    if not (settings.get("instruction_sql") or "").strip():
        return "нет SQL-шаблона инструкции (create_incident_instruction из test_sql_templates.json)"
    if not settings.get("db_connection_id"):
        return "не выбрано подключение к БД инцидентов"
    return ""


def _run_sql(conn_cfg: dict, sql: str) -> list:
    from backend.api.db_connector import get_db_connection
    conn, _ = get_db_connection(conn_cfg)
    try:
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchall() if cur.description else []
        try:
            conn.commit()
        except Exception:
            pass                                      # autocommit-подключение
        cur.close()
        return rows
    finally:
        conn.close()


def write_instructions(done: list[dict], settings: dict) -> None:
    """Инструкции к отправленным основным инцидентам. Инцидент мог ещё не дойти до БД — тогда ещё две попытки."""
    from db.testdata_connections import TestDataConnectionsStore
    todo = [d for d in done if d["main"] and d.get("instruction") and not d.get("error")]
    if not todo:
        return
    why = instructions_ready(settings)
    conn_cfg = TestDataConnectionsStore.get_connection(settings.get("db_connection_id", "")) if not why else None
    if not why and not conn_cfg:
        why = "подключение к БД не найдено — выберите его в настройках"
    if why:
        for d in todo:
            d["instruction_error"] = why
        return
    wait = int(settings.get("instruction_wait_sec") or 0)
    pending = todo
    for attempt in range(3):
        time.sleep(wait if attempt == 0 else max(wait, 3))
        left = []
        for d in pending:
            try:
                rows = _run_sql(conn_cfg, render_sql(settings["instruction_sql"], instruction_params(d, settings)))
                if rows:
                    d["instruction_id"] = str(rows[0][0])
                    d.pop("instruction_error", None)
                else:
                    d["instruction_error"] = "запрос не вернул строк — инцидента ещё нет в БД"
                    left.append(d)
            except Exception as e:                    # ошибка SQL — повтор не поможет
                d["instruction_error"] = f"{type(e).__name__}: {str(e)[:300]}"
        pending = left
        if not pending:
            break


# ── Отправка ─────────────────────────────────────────────────────────────────

def kafka_cfg(settings: dict) -> dict:
    from db.kafka_explorer_store import KafkaExplorerStore
    conn = KafkaExplorerStore.get_connection(settings.get("kafka_connection_id") or "")
    if not conn:
        raise HTTPException(422, "Не выбрано подключение Kafka — укажите его в настройках генератора")
    return KafkaExplorerStore.to_kafka_cfg(conn)


def send_all(built: list[dict], settings: dict) -> list[dict]:
    """Все сообщения одним продюсером; у каждого — свой ключ и свой результат (offset или ошибка)."""
    from agents.kafka_client import KafkaClient
    cfg = kafka_cfg(settings)
    try:
        producer = KafkaClient._build_producer(cfg)
    except Exception as e:
        raise HTTPException(502, f"Kafka недоступна: {type(e).__name__}: {str(e)[:300]}")
    topic, part = settings["topic"], settings.get("partition")
    out: list[dict] = []
    try:
        futures = []
        for b in built:
            key = f"111{str(uuid.uuid4())[3:]}"
            kw: dict = {"value": json.dumps(b["message"], ensure_ascii=False).encode("utf-8"), "key": key.encode("utf-8")}
            if part is not None:
                kw["partition"] = int(part)
            try:
                futures.append(producer.send(topic, **kw))
            except Exception as e:
                futures.append(e)
        producer.flush(timeout=30)
        for b, fut in zip(built, futures):
            res = {"ci": b["ci"], "main": b["main"], "inc": b["message"]["businessId"], "title": b["message"]["title"],
                   "instruction": b["instruction"], "message": b["message"], "summary": b["summary"]}
            if isinstance(fut, Exception):
                res["error"] = f"{type(fut).__name__}: {str(fut)[:300]}"
            else:
                try:
                    meta = fut.get(timeout=15)
                    res.update(offset=meta.offset, partition=meta.partition)
                except Exception as e:
                    res["error"] = f"{type(e).__name__}: {str(e)[:300]}"
            out.append(res)
    finally:
        try:
            producer.close(timeout=5)
        except Exception:
            pass
    return out


# ── API ──────────────────────────────────────────────────────────────────────

@router.get("/api/incident-gen/state")
def get_state() -> dict:
    data = store.read()
    s = data["settings"]
    return {"settings": s, "library": data["library"], "presets": data["presets"],
            "instructionsBlocked": instructions_ready(s)}


@router.put("/api/incident-gen/settings")
def put_settings(body: SettingsBody) -> dict:
    def fn(data: dict) -> dict:
        data["settings"] = {**data["settings"], **body.model_dump()}
        return data["settings"]
    s = store.update(fn)
    return {"settings": s, "instructionsBlocked": instructions_ready(s)}


@router.post("/api/incident-gen/preview")
def preview(spec: Spec) -> dict:
    data = store.read()
    items = plan(spec, data["library"])
    built = [build(spec, data["settings"], it, i + 1) for i, it in enumerate(items)]
    return {"total": len(built), "main": sum(1 for b in built if b["main"]), "items": built[:50]}


class SendBody(BaseModel):
    spec: Spec
    preset: str = ""


@router.post("/api/incident-gen/send")
async def send(body: SendBody) -> dict:
    data = store.read()
    settings, spec = data["settings"], body.spec
    items = plan(spec, data["library"])
    built = [build(spec, settings, it, i + 1) for i, it in enumerate(items)]

    def work() -> list[dict]:
        done = send_all(built, settings)
        if spec.instruction_mode != "none":
            write_instructions(done, settings)
        return done

    done = await asyncio.to_thread(work)
    results = [{k: d.get(k) for k in ("ci", "main", "inc", "title", "offset", "partition", "error",
                                       "instruction_id", "instruction_error")} | {"hasInstruction": bool(d["instruction"])}
               for d in done]
    run = {"id": store.new_id(), "at": store.stamp(), "preset": body.preset, "topic": settings["topic"],
           "cis": [c.code for c in spec.cis], "results": results}

    def save(d: dict) -> None:
        d["history"] = ([run] + d["history"])[:store.HISTORY_MAX]
    store.update(save)
    return run


@router.get("/api/incident-gen/history")
def history() -> dict:
    return {"history": store.read()["history"]}


@router.delete("/api/incident-gen/history")
def clear_history() -> dict:
    store.update(lambda d: d.update(history=[]))
    return {"history": []}


@router.post("/api/incident-gen/presets")
def save_preset(body: PresetBody) -> dict:
    """Пресет с тем же названием перезаписывается."""
    def fn(d: dict) -> list:
        name = body.name.strip()
        rest = [p for p in d["presets"] if p["name"].lower() != name.lower()]
        d["presets"] = sorted(rest + [{"id": store.new_id(), "name": name, "spec": body.spec.model_dump()}], key=lambda p: p["name"].lower())
        return d["presets"]
    return {"presets": store.update(fn)}


@router.delete("/api/incident-gen/presets/{pid}")
def delete_preset(pid: str) -> dict:
    def fn(d: dict) -> list:
        d["presets"] = [p for p in d["presets"] if p["id"] != pid]
        return d["presets"]
    return {"presets": store.update(fn)}


@router.post("/api/incident-gen/library")
def add_library(body: LibraryItem) -> dict:
    def fn(d: dict) -> list:
        d["library"].append({"id": store.new_id(), **body.model_dump()})
        return d["library"]
    return {"library": store.update(fn)}


@router.put("/api/incident-gen/library/{lid}")
def edit_library(lid: str, body: LibraryItem) -> dict:
    def fn(d: dict) -> list:
        cur = next((x for x in d["library"] if x["id"] == lid), None)
        if cur is None:
            raise HTTPException(404, "Примера уже нет")
        cur.update(body.model_dump())
        return d["library"]
    return {"library": store.update(fn)}


@router.delete("/api/incident-gen/library/{lid}")
def delete_library(lid: str) -> dict:
    def fn(d: dict) -> list:
        d["library"] = [x for x in d["library"] if x["id"] != lid]
        return d["library"]
    return {"library": store.update(fn)}


# Строки описаний реальных инцидентов с контактами людей: в тестовых инцидентах они не нужны, а хранить их незачем.
_CONTACT_LINE = re.compile(r"^\s*(местный тел|сотовый тел|мобильный тел|телефон|менеджер ит-услуги|назначено группе|"
                           r"назначено исполнителю|контакты|отправитель|управление|отдел|сектор)\b", re.I)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
# «Иванов И. И.», «И. И. Иванов», «Иванов Иван Иванович».
_FIO = re.compile(r"\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.|\b[А-ЯЁ]\.\s?[А-ЯЁ]\.\s?[А-ЯЁ][а-яё]+|"
                  r"\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:вич|вна|ична)\b")
_PHONE = re.compile(r"(?<![\w-])(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?![\w-])")


def scrub(text: str) -> str:
    """Без строк с контактами (менеджер, телефоны, исполнитель); почта, телефоны и ФИО в остальном тексте — скрыты."""
    lines = [l for l in text.replace("\r", "").split("\n") if not _CONTACT_LINE.match(l)]
    out = _FIO.sub("[сотрудник]", _PHONE.sub("[телефон]", _EMAIL.sub("[почта]", "\n".join(lines))))
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def scenario_spec(sc: dict) -> dict:
    """Сценарий из test_sc.json → настройки генератора (как его выполнял ноутбук)."""
    acts = set(sc.get("actions") or [])
    extra = "additional_incident" in acts
    return Spec(cis=[Ci(code=str(c)) for c in sc.get("systems") or []] or [Ci(code="CI00000000")],
                main_count=1 if "incident" in acts else 0,
                extra_min=1 if extra else 0, extra_max=5 if extra else 0,
                description_mode="library",
                instruction_mode="library" if "instruction" in acts else "none").model_dump()


@router.post("/api/incident-gen/import")
async def import_file(file: UploadFile = File(...)) -> dict:
    """
    Импорт файлов из набора ноутбука — формат определяется по содержимому:
      • incident_instruction_examples.json — примеры описаний и инструкций в библиотеку (без полей о людях,
        строк с контактами, почты и телефонов);
      • test_sc.json — сценарии в пресеты;
      • test_sql_templates.json — SQL-шаблон инструкции в настройки.
    """
    try:
        data = json.loads((await file.read()).decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(422, "Это не JSON")
    if isinstance(data, dict) and isinstance(data.get("incident_instruction"), list):
        def fn(d: dict) -> int:
            have = {x["description"] for x in d["library"]}
            added = 0
            for ex in data["incident_instruction"]:
                desc = scrub(str(ex.get("incident_description") or ""))
                if not desc or desc in have:
                    continue
                have.add(desc)
                d["library"].append({"id": store.new_id(), "system": str(ex.get("system_name") or ""), "description": desc,
                                     "summary": scrub(str(ex.get("incident_summarization") or "")),
                                     "instruction": scrub(str(ex.get("instruction") or ""))})
                added += 1
            return added
        return {"kind": "library", "added": store.update(fn)}
    if isinstance(data, dict) and isinstance(data.get("create_incident_instruction"), str):
        sql = data["create_incident_instruction"]
        store.update(lambda d: d["settings"].update(instruction_sql=sql))
        return {"kind": "sql", "added": 1}
    if isinstance(data, dict) and data and all(isinstance(v, dict) and "actions" in v for v in data.values()):
        def fn2(d: dict) -> int:
            names = {p["name"].lower() for p in d["presets"]}
            added = 0
            for key, sc in data.items():
                name = str(sc.get("name") or key).strip()
                if name.lower() in names:
                    continue
                names.add(name.lower())
                d["presets"].append({"id": store.new_id(), "name": name, "spec": scenario_spec(sc)})
                added += 1
            d["presets"].sort(key=lambda p: p["name"].lower())
            return added
        return {"kind": "presets", "added": store.update(fn2)}
    raise HTTPException(422, "Не узнал файл: ожидаются incident_instruction_examples.json, test_sc.json или test_sql_templates.json")
