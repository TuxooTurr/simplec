"""
Регистрация дефектов в корпоративной Jira (Data Center) напрямую через REST API.

Авторизация — Personal Access Token (PAT):
  - автополучение по логину/паролю Сигмы через POST /rest/pat/latest/tokens
    (пароль НЕ сохраняется — только полученный токен);
  - либо путь к файлу с токеном (аналогично сертификатам LLM);
  - либо токен строкой.

Кастомные поля (КЭ, Среда обнаружения, Стенд, Epic Link) резолвятся по ИМЕНИ
через createmeta — id полей (customfield_XXXXX) в разных Jira отличаются.

Эндпоинты:
  GET  /api/jira/settings          — настройки (токен маскируется)
  PUT  /api/jira/settings          — сохранить настройки
  POST /api/jira/token-from-login  — получить PAT по логину/паролю Сигмы
  GET  /api/jira/test              — проверка подключения (myself)
  GET  /api/jira/meta              — приоритеты, компоненты, поля проекта
  GET  /api/jira/epics             — поиск эпиков по части названия
  GET  /api/jira/users             — поиск исполнителя
  POST /api/jira/create            — создать дефект
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.postgres import get_db
from db.metrics_models import MetricsSettings

logger = logging.getLogger(__name__)
router = APIRouter()

_MASK = "●●●●●●●●●●●●"

# Ключи в metrics_settings
_K_URL        = "jira_base_url"
_K_TOKEN      = "jira_token"
_K_TOKEN_PATH = "jira_token_path"
_K_SSL_VERIFY = "jira_ssl_verify"     # "1" / "" (пусто = выключено, корп. BIG IP)
_K_LABELS     = "jira_labels_presets" # JSON-список пресетов лейблов
_K_ISSUETYPE  = "jira_issuetype"

_DEFAULT_LABELS = ["Фокус911", "ПРМ", "Sber911-AI"]

# Имена полей в Jira, которые резолвим по названию (регистронезависимо).
# Для каждого логического поля — варианты написания в корп. Jira.
_FIELD_NAME_HINTS: dict[str, list[str]] = {
    "epic_link":   ["epic link", "epic-link", "эпик"],
    "ke":          ["кэ", "конфигурационная единица", "configuration item"],
    "environment": ["среда обнаружения", "среда выявления"],
}


# ── Настройки ────────────────────────────────────────────────────────────────

def _get(db: Session, key: str, default: str = "") -> str:
    row = db.query(MetricsSettings).filter(MetricsSettings.key == key).first()
    return row.value if row and row.value is not None else default


def _set(db: Session, key: str, value: str, description: str = "") -> None:
    row = db.query(MetricsSettings).filter(MetricsSettings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(MetricsSettings(key=key, value=value, description=description))


def _load_cfg(db: Session) -> dict:
    labels_raw = _get(db, _K_LABELS, "")
    try:
        labels = json.loads(labels_raw) if labels_raw else list(_DEFAULT_LABELS)
        if not isinstance(labels, list):
            labels = list(_DEFAULT_LABELS)
    except Exception:
        labels = list(_DEFAULT_LABELS)
    return {
        "base_url":   (_get(db, _K_URL, "https://jira.sberbank.ru")).rstrip("/"),
        "token":      _get(db, _K_TOKEN, ""),
        "token_path": _get(db, _K_TOKEN_PATH, ""),
        "ssl_verify": _get(db, _K_SSL_VERIFY, "") == "1",
        "labels":     labels,
        "issuetype":  _get(db, _K_ISSUETYPE, "Дефект"),
    }


def _resolve_token(cfg: dict) -> str:
    """Токен: значение из настроек, иначе — из файла по пути."""
    if cfg["token"]:
        return cfg["token"]
    path = cfg["token_path"]
    if path:
        p = Path(path).expanduser()
        if not p.exists():
            raise HTTPException(400, f"Файл токена не найден: {path}")
        token = p.read_text(encoding="utf-8").strip()
        if token:
            return token
        raise HTTPException(400, f"Файл токена пустой: {path}")
    raise HTTPException(400, "Jira-токен не настроен: получите его по логину/паролю Сигмы или укажите путь к файлу (Настройки → Jira)")


def _jira_request(cfg: dict, method: str, path: str,
                  json_body: Optional[dict] = None,
                  params: Optional[dict] = None,
                  auth: Optional[tuple] = None,
                  timeout: int = 30) -> Any:
    """Запрос к Jira. auth=(login, password) — Basic (для получения PAT), иначе Bearer."""
    import requests

    url = cfg["base_url"] + path
    # UA обязателен: корп. WAF/BIG IP часто блокирует дефолтный python-requests (403),
    # при этом curl с тем же токеном проходит.
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; SimpleTest-QA/1.0)",
    }
    if auth is None:
        headers["Authorization"] = "Bearer " + _resolve_token(cfg)

    # Тело запроса не содержит секретов (пароль идёт через auth=, не через json_body) —
    # логируем как есть, это и есть детализация ошибки, которую видно только в терминале.
    logger.info("Jira → %s %s params=%s body=%s", method, url, params, json_body)

    try:
        resp = requests.request(
            method, url,
            json=json_body, params=params, headers=headers,
            auth=auth, verify=cfg["ssl_verify"], timeout=timeout,
        )
    except requests.exceptions.SSLError as e:
        logger.error("Jira SSL-ошибка %s %s: %s", method, url, e)
        raise HTTPException(502, f"SSL-ошибка при подключении к Jira: {str(e)[:200]}. "
                                 "Отключите проверку сертификата в настройках Jira (корп. BIG IP).")
    except requests.exceptions.RequestException as e:
        logger.error("Jira недоступна %s %s: %s", method, url, e)
        raise HTTPException(502, f"Jira недоступна ({url}): {str(e)[:200]}")

    logger.info("Jira ← %s %s -> %s", method, url, resp.status_code)

    if resp.status_code >= 400:
        # Полное тело + заголовки — на уровне ERROR, чтобы «Не удается создать проблему
        # прямо сейчас» и подобные общие сообщения Jira было чем расшифровывать: часто
        # реальная причина видна только в сыром теле ответа или в заголовке-корреляторе,
        # по которому администратор Jira найдёт запись в серверном логе (Jira DC пишет
        # X-AREQUESTID в каждый ответ).
        request_id = (resp.headers.get("X-AREQUESTID") or resp.headers.get("X-Request-Id")
                      or resp.headers.get("X-Correlation-Id") or "")
        logger.error(
            "Jira ошибка %s %s -> %s\nrequest_id=%s\nheaders=%s\nbody=%s",
            method, url, resp.status_code, request_id, dict(resp.headers), resp.text[:4000],
        )

    if resp.status_code == 401:
        raise HTTPException(401, "Jira: токен недействителен или истёк — обновите его в настройках")
    if resp.status_code == 403:
        raise HTTPException(403, "Jira: нет прав на операцию (403)")
    if resp.status_code >= 400:
        detail = resp.text[:500]
        try:
            j = resp.json()
            msgs = j.get("errorMessages", []) or []
            errs = j.get("errors", {}) or {}
            parts = list(msgs) + [f"{k}: {v}" for k, v in errs.items()]
            if parts:
                detail = "; ".join(parts)[:500]
        except Exception:
            pass
        if request_id:
            detail += f" [ID запроса для админа Jira: {request_id}]"
        raise HTTPException(resp.status_code, f"Jira: {detail}")

    if resp.status_code == 204 or not resp.content:
        return {}
    return resp.json()


# ── Резолв кастомных полей по имени (кэш на процесс) ─────────────────────────

_fields_cache: dict[str, tuple[float, dict]] = {}
_FIELDS_TTL = 600        # 10 минут — успешный резолв (схема проекта меняется редко)
_FIELDS_ERROR_TTL = 20   # провал резолва — почти не кешируем, иначе одна временная
                         # сетевая заминка "отравляет" кэш на 10 минут: все дефекты в
                         # этом окне уйдут со старым (неверным) форматом полей и тем же
                         # набором ошибок ("должно быть строкой" / "приоритет неверен"),
                         # хотя createmeta уже мог снова заработать через пару секунд.


def _pick_issuetype(issuetypes: list[dict], wanted: str) -> Optional[dict]:
    it = next((t for t in issuetypes if t.get("name", "").lower() == wanted.lower()), None)
    if it is None:
        it = next((t for t in issuetypes if t.get("name", "").lower() in ("bug", "баг", "ошибка", "дефект")),
                  issuetypes[0] if issuetypes else None)
    return it


def _match_fields(field_items: list[tuple[str, dict]], issuetype_name: str) -> dict:
    """field_items: [(field_id, {name, schema, allowedValues}), ...] → маппинг логических полей."""
    resolved: dict[str, Any] = {"_issuetype": issuetype_name, "_available": [], "_by_id": {}}
    for fid, fdef in field_items:
        fname = str(fdef.get("name", "")).strip()
        resolved["_available"].append(fname)
        allowed = [
            v.get("value") or v.get("name") or ""
            for v in fdef.get("allowedValues", []) or []
        ]
        allowed = [a for a in allowed if a]
        # Полный справочник по id — нужен, чтобы узнать реальный wire-формат (schema.type)
        # для полей, которые резолвим не по имени, а по захардкоженному id (КЭ, ИТ-услуга и т.п.):
        # Jira возвращает разный тип под одним и тем же customfield_ в разных инстансах
        # (объект vs просто строка), и отправка неверного формата даёт ошибку "Значение
        # операции должно быть строкой" — эту ошибку словили на реальном SBER911.
        resolved["_by_id"][fid] = {"name": fname, "schema": fdef.get("schema") or {}, "allowed": allowed}
        low = fname.lower()
        for logical, hints in _FIELD_NAME_HINTS.items():
            if logical in resolved:
                continue
            if any(h in low for h in hints):
                resolved[logical] = {"id": fid, "name": fname, "allowed": allowed}
    return resolved


def _field_schema_type(resolved: dict, field_id: str) -> str:
    """schema.type поля по его id из createmeta ('string'/'array'/'option'/...), либо '' если неизвестно."""
    return (resolved.get("_by_id", {}).get(field_id, {}) or {}).get("schema", {}).get("type", "")


def _reference_value(resolved: dict, field_id: str, item: dict) -> Any:
    """Значение справочного поля (ИТ-услуга, КЭ) в форме, которую ждёт эта Jira.

    Один и тот же customfield в разных инстансах объявлен по-разному, поэтому
    форму берём из схемы поля в createmeta:
      array  — список объектов, как в выгрузке реальных дефектов SBER911;
      option — один объект;
      string — просто значение.

    Когда createmeta недоступен, схемы нет — отправляем строкой: оба раза, когда
    реальная Jira на SBER911 ругалась на эти поля, она требовала именно строку
    («Значение операции должно быть строкой»).
    """
    schema = _field_schema_type(resolved, field_id)
    if schema == "array":
        return [dict(item)]
    if schema and schema != "string":
        return dict(item)
    return item["value"]


def _resolve_fields(cfg: dict, project: str, issuetype: str) -> dict:
    """
    Маппинг логических полей (КЭ, среда, стенд, эпик) на customfield-id + allowedValues.

    Пробуем два API:
      1) классический createmeta с expand (Jira ≤ 8.x);
      2) постраничный createmeta Jira 8.4+/9 (/createmeta/{key}/issuetypes/{id}) —
         старый эндпоинт там отключён и отдаёт 403/404/405.
    При полном провале возвращаем {"_error": ...} — создание работает без кастомных полей.
    """
    cache_key = f"{cfg['base_url']}|{project}|{issuetype}"
    now = time.time()
    hit = _fields_cache.get(cache_key)
    if hit and now - hit[0] < _FIELDS_TTL:
        return hit[1]

    errors: list[str] = []
    resolved: Optional[dict] = None

    # ── Вариант 1: классический createmeta ──
    try:
        data = _jira_request(cfg, "GET", "/rest/api/2/issue/createmeta", params={
            "projectKeys": project,
            "expand": "projects.issuetypes.fields",
        })
        projects = data.get("projects", [])
        if projects:
            it = _pick_issuetype(projects[0].get("issuetypes", []), issuetype)
            if it and it.get("fields"):
                resolved = _match_fields(list(it["fields"].items()), it.get("name", issuetype))
        if resolved is None:
            errors.append("createmeta: проект/тип задачи не найден в ответе")
    except HTTPException as e:
        errors.append(f"createmeta: {e.detail}")

    # ── Вариант 2: Jira 8.4+/9 постраничный API ──
    if resolved is None:
        try:
            its = _jira_request(cfg, "GET", f"/rest/api/2/issue/createmeta/{project}/issuetypes",
                                params={"maxResults": 100})
            it = _pick_issuetype(its.get("values", []), issuetype)
            if it is None:
                raise HTTPException(404, "нет доступных типов задач")
            fdata = _jira_request(
                cfg, "GET",
                f"/rest/api/2/issue/createmeta/{project}/issuetypes/{it.get('id', '')}",
                params={"maxResults": 200},
            )
            items = [(f.get("fieldId", ""), f) for f in fdata.get("values", []) if f.get("fieldId")]
            resolved = _match_fields(items, it.get("name", issuetype))
        except HTTPException as e:
            errors.append(f"createmeta v2: {e.detail}")

    if resolved is None:
        resolved = {"_issuetype": issuetype, "_available": [], "_error": "; ".join(errors)[:400]}
        logger.warning(
            "Jira createmeta недоступен для project=%s issuetype=%s: %s — "
            "поля КЭ/эпик/среда берутся из захардкоженных id в jira_constants.py "
            "(могут не совпасть с реальной схемой этого инстанса Jira)",
            project, issuetype, resolved["_error"],
        )
    else:
        logical_ids = {k: v.get("id") for k, v in resolved.items() if k in _FIELD_NAME_HINTS}
        logger.info(
            "Jira createmeta OK для project=%s issuetype=%s: %d полей на экране, распознаны по имени: %s",
            project, issuetype, len(resolved.get("_available", [])), logical_ids,
        )

    ttl_start = now if not resolved.get("_error") else now - _FIELDS_TTL + _FIELDS_ERROR_TTL
    _fields_cache[cache_key] = (ttl_start, resolved)
    return resolved


# ── Markdown → Jira wiki (минимально достаточно для отчёта) ──────────────────

def _md_to_jira(text: str) -> str:
    import re
    out = text
    out = re.sub(r"```(\w*)\n([\s\S]*?)```", lambda m: "{code}\n" + m.group(2) + "{code}", out)
    # Картинка ![имя](файл) → !файл|thumbnail! — Jira покажет скрин прямо
    # в описании, если вложение с таким именем приложено к задаче.
    # Идёт до обработки ссылок и **жирного**, иначе разметка распадётся.
    out = re.sub(r"!\[[^\]]*\]\(([^)\s]+)\)", r"!\1|thumbnail!", out)
    out = re.sub(r"^######\s+(.+)$", r"h6. \1", out, flags=re.M)
    out = re.sub(r"^#####\s+(.+)$",  r"h5. \1", out, flags=re.M)
    out = re.sub(r"^####\s+(.+)$",   r"h4. \1", out, flags=re.M)
    out = re.sub(r"^###\s+(.+)$",    r"h3. \1", out, flags=re.M)
    out = re.sub(r"^##\s+(.+)$",     r"h2. \1", out, flags=re.M)
    out = re.sub(r"^#\s+(.+)$",      r"h1. \1", out, flags=re.M)
    out = re.sub(r"\*\*(.+?)\*\*",   r"*\1*",   out)
    out = re.sub(r"`([^`\n]+)`",     r"{{\1}}", out)
    return out


# ── Schemas ──────────────────────────────────────────────────────────────────

class JiraSettingsBody(BaseModel):
    base_url: str = "https://jira.sberbank.ru"
    token: str = ""            # _MASK → не менять
    token_path: str = ""
    ssl_verify: bool = False
    labels: list[str] = Field(default_factory=list)
    issuetype: str = "Дефект"


class TokenFromLoginBody(BaseModel):
    login: str
    password: str
    base_url: str = ""         # опционально: сохранить URL заодно


class CreateDefectBody(BaseModel):
    project: str
    summary: str
    description: str = ""
    priority: str = ""         # имя приоритета Jira («Высокий» и т.п.)
    labels: list[str] = Field(default_factory=list)
    epic_key: str = ""
    components: list[str] = Field(default_factory=list)
    assignee: str = ""         # username
    ke: str = ""               # КЭ текстом — для проектов без маппинга компонент→КЭ
    environment: str = ""      # среда обнаружения — для проектов без дефолта в справочнике
    stand_type: str = ""       # тип стенда (Major-Check / Major-GO) — если пусто, берём дефолт справочника
    description_is_markdown: bool = True
    # Тип задачи. Пусто — тип из настроек (Дефект). Для не-дефекта (например, «Задача»)
    # поля, обязательные только для дефекта SBER911 (вид испытаний, тип объекта, стенд), не уходят.
    issuetype: str = ""


# ── Routes: настройки и токен ────────────────────────────────────────────────

@router.get("/api/jira/settings")
def get_settings(db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    return {
        "base_url":   cfg["base_url"],
        "token":      _MASK if cfg["token"] else "",
        "token_path": cfg["token_path"],
        "ssl_verify": cfg["ssl_verify"],
        "labels":     cfg["labels"],
        "issuetype":  cfg["issuetype"],
    }


@router.put("/api/jira/settings")
def put_settings(body: JiraSettingsBody, db: Session = Depends(get_db)) -> dict:
    _set(db, _K_URL, body.base_url.strip().rstrip("/"), "Jira base URL")
    if body.token != _MASK:
        _set(db, _K_TOKEN, body.token.strip(), "Jira PAT (секрет)")
    _set(db, _K_TOKEN_PATH, body.token_path.strip(), "Путь к файлу с Jira-токеном")
    _set(db, _K_SSL_VERIFY, "1" if body.ssl_verify else "", "Проверка SSL Jira")
    _set(db, _K_LABELS, json.dumps([l for l in body.labels if l.strip()], ensure_ascii=False),
         "Пресеты лейблов дефектов")
    _set(db, _K_ISSUETYPE, body.issuetype.strip() or "Дефект", "Тип задачи для дефектов")
    db.commit()
    return get_settings(db)


def label_name(label: str) -> str:
    """Лейбл как его примет Jira: без пробелов по краям, пробелы внутри — «_» (так он и уходит в задачу)."""
    return label.strip().replace(" ", "_")


class LabelPresetsBody(BaseModel):
    labels: list[str] = Field(default_factory=list)


@router.post("/api/jira/labels")
def add_label_presets(body: LabelPresetsBody, db: Session = Depends(get_db)) -> dict:
    """Добавить лейблы в общий список пресетов (навсегда, пока их не уберут в настройках Jira).
    Только дописывает — остальные настройки не трогает, повторы (без учёта регистра) пропускает."""
    presets = list(_load_cfg(db)["labels"])
    have = {l.lower() for l in presets}
    for l in (label_name(x) for x in body.labels):
        if l and l.lower() not in have:
            presets.append(l)
            have.add(l.lower())
    _set(db, _K_LABELS, json.dumps(presets, ensure_ascii=False), "Пресеты лейблов дефектов")
    db.commit()
    return {"labels": presets}


@router.post("/api/jira/token-from-login")
def token_from_login(body: TokenFromLoginBody, db: Session = Depends(get_db)) -> dict:
    """Создать PAT по логину/паролю Сигмы. Пароль не сохраняется."""
    if body.base_url.strip():
        _set(db, _K_URL, body.base_url.strip().rstrip("/"), "Jira base URL")
        db.commit()
    cfg = _load_cfg(db)

    result = _jira_request(
        cfg, "POST", "/rest/pat/latest/tokens",
        json_body={"name": f"SimpleTest {time.strftime('%Y-%m-%d %H:%M')}",
                   "expirationDuration": 180},
        auth=(body.login.strip(), body.password),
    )
    token = result.get("rawToken", "")
    if not token:
        raise HTTPException(502, "Jira не вернула токен (rawToken) — возможно, PAT отключены администратором. "
                                 "Создайте токен вручную в профиле Jira и вставьте его или укажите путь к файлу.")
    _set(db, _K_TOKEN, token, "Jira PAT (секрет)")
    db.commit()
    return {"status": "ok", "token": _MASK, "expires_days": 180}


@router.get("/api/jira/test")
def test_connection(db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    me = _jira_request(cfg, "GET", "/rest/api/2/myself")
    return {"status": "ok", "user": me.get("displayName", ""), "name": me.get("name", "")}


# ── Routes: справочники ──────────────────────────────────────────────────────


@router.get("/api/jira/meta")
def project_meta(project: str = Query(...), db: Session = Depends(get_db)) -> dict:
    """Справочники проекта. Ошибка одного справочника не валит остальные."""
    from backend.api import jira_constants as JC
    cfg = _load_cfg(db)
    warnings: list[str] = []
    is_sber911 = project.strip().upper() == JC.PROJECT_KEY

    try:
        components = [c.get("name", "") for c in
                      _jira_request(cfg, "GET", f"/rest/api/2/project/{project}/components")]
    except HTTPException as e:
        components, _ = [], warnings.append(f"компоненты: {e.detail}")
    if is_sber911:
        # Полный список компонентов проекта гораздо длиннее — оставляем только
        # реально используемые (см. jira_constants.COMPONENT_KEYWORDS).
        components = JC.filter_components(components)

    fields = _resolve_fields(cfg, project, cfg["issuetype"])
    if fields.get("_error"):
        warnings.append(f"поля (КЭ/эпик): {fields['_error']}")

    if is_sber911:
        # Приоритеты SBER911 — свой справочник по id (см. jira_constants.PRIORITY):
        # и createmeta, и глобальный список Jira по имени уже давали
        # "Имя приоритета 'X' неверно" на реально валидных значениях — id надёжнее.
        priorities = list(JC.PRIORITY.keys())
    else:
        # Приоритет: список из createmeta (allowedValues поля "priority") — он реально
        # ограничен priority-схемой проекта/типа задачи. Список из /rest/api/2/priority
        # глобальный для всей Jira и может включать значения, недопустимые для этого
        # проекта — Jira тогда отвечает "Имя приоритета 'X' неверно".
        priority_field = fields.get("_by_id", {}).get("priority", {})
        priorities = priority_field.get("allowed", [])
        if not priorities:
            try:
                priorities = [p.get("name", "") for p in _jira_request(cfg, "GET", "/rest/api/2/priority")]
                warnings.append("приоритеты не удалось получить из createmeta — показан общий список Jira, "
                                 "часть значений может быть недоступна в этом проекте")
            except HTTPException as e:
                priorities, _ = [], warnings.append(f"приоритеты: {e.detail}")

    return {
        "priorities": priorities,
        "components": components,
        "issuetype":  fields.get("_issuetype", cfg["issuetype"]),
        "fields": {
            k: {"name": v["name"], "allowed": v["allowed"]}
            for k, v in fields.items() if not k.startswith("_")
        },
        "labels_presets": cfg["labels"],
        "warnings": warnings,
        # мобильные компоненты — при их выборе разрешён второй компонент.
        # Списка «компонент → КЭ» больше нет: КЭ одна и та же всегда.
        "mobile_components": sorted(JC.MOBILE_COMPONENTS) if is_sber911 else [],
        # тип стенда (customfield_17500) — Major-Check / Major-GO, видимый выбор
        "stand_types": sorted(JC.STAND_TYPE.keys()) if is_sber911 else [],
        "default_stand_type": JC.DEFAULT_STAND_TYPE if is_sber911 else "",
    }


_epics_cache: dict[str, tuple[float, list]] = {}
_EPICS_TTL = 300


@router.get("/api/jira/epics")
def list_epics(project: str = Query(...), db: Session = Depends(get_db)) -> dict:
    """Все активные эпики проекта (без Отменён/Сделан/Closed) с пагинацией."""
    cfg = _load_cfg(db)
    now = time.time()
    cache_key = f"{cfg['base_url']}|{project}"
    hit = _epics_cache.get(cache_key)
    if hit and now - hit[0] < _EPICS_TTL:
        return {"epics": hit[1]}

    jql_active = (f'project = "{project}" AND issuetype = Epic '
                  'AND status not in (Отменён, Сделан, Closed) ORDER BY key ASC')
    jql_all = f'project = "{project}" AND issuetype = Epic ORDER BY key ASC'

    def _fetch(jql: str) -> list[dict]:
        epics, start, total = [], 0, 1
        while start < total and start < 1000:
            data = _jira_request(cfg, "GET", "/rest/api/2/search", params={
                "jql": jql, "fields": "summary,status",
                "maxResults": 100, "startAt": start,
            })
            total = int(data.get("total", 0))
            for i in data.get("issues", []):
                epics.append({
                    "key": i.get("key", ""),
                    "summary": i.get("fields", {}).get("summary", ""),
                    "status": (i.get("fields", {}).get("status") or {}).get("name", ""),
                })
            start += 100
        return epics

    try:
        epics = _fetch(jql_active)
    except HTTPException:
        # в проекте может не быть статусов «Отменён/Сделан» — тогда без фильтра
        epics = _fetch(jql_all)

    _epics_cache[cache_key] = (now, epics)
    return {"epics": epics}



# ── Routes: создание дефекта ─────────────────────────────────────────────────

def _reference_candidates(item: dict, schema: str) -> list[Any]:
    """Форматы значения справочного поля, от наиболее вероятного к запасным.

    Один и тот же customfield в разных инстансах Jira объявлен по-разному, а на
    экране создания поля может не быть вовсе — тогда схема неизвестна. Перебор
    нужен, чтобы не гадать: первый принятый формат и есть правильный.
    """
    obj = dict(item)
    forms: list[Any] = []
    if schema == "array":
        forms = [[obj], [{"id": item["id"]}], [item["value"]], obj, item["value"]]
    elif schema and schema != "string":
        forms = [obj, {"id": item["id"]}, [obj], item["value"]]
    elif schema == "string":
        forms = [item["value"], [obj], obj]
    else:
        # Схемы нет (поле не на экране создания либо createmeta недоступен).
        # Начинаем с формы из выгрузки реальных дефектов SBER911.
        forms = [[obj], obj, item["value"], [{"id": item["id"]}]]
    # Поля Сбера типа «КЭ» (sbtconfigurationitemmulticftype) Jira показывает как «название (id)» —
    # пробуем и голый id, и такую строку: лишний вариант Jira просто отклонит.
    labelled = f"{item['value']} ({item['id']})"
    forms += [[item["id"]], item["id"], [labelled], labelled]
    # Без дублей, порядок сохраняем
    seen, uniq = set(), []
    for f in forms:
        marker = json.dumps(f, sort_keys=True, ensure_ascii=False)
        if marker not in seen:
            seen.add(marker)
            uniq.append(f)
    return uniq


def _is_field_filled(value: Any) -> bool:
    return not (value is None or value == "" or value == [] or value == {})


def _ensure_reference_fields(cfg: dict, key: str, resolved: dict,
                             targets: list[tuple[str, str, dict]],
                             warnings: list[str]) -> None:
    """Проверяет, что справочные поля реально записались, и дозаполняет их.

    Jira может принять создание задачи и молча проигнорировать поле, которого
    нет на экране создания, — задача заводится «успешно», а ИТ-услуга и КЭ
    остаются пустыми. Поэтому читаем задачу обратно и, если поле пустое,
    доставляем его отдельным редактированием: на экране редактирования поле
    обычно доступно, даже когда на экране создания его нет.
    """
    ids = [fid for fid, _, _ in targets]
    try:
        issue = _jira_request(cfg, "GET", f"/rest/api/2/issue/{key}",
                              params={"fields": ",".join(ids)})
    except HTTPException as e:
        logger.warning("Jira create: %s не удалось перечитать поля: %s", key, e.detail)
        return

    current = issue.get("fields", {}) or {}
    for fid, label, item in targets:
        if _is_field_filled(current.get(fid)):
            logger.info("Jira create: %s поле %s (%s) проставлено", key, label, fid)
            continue

        schema = _field_schema_type(resolved, fid)
        on_screen = fid in (resolved.get("_by_id") or {})
        logger.warning(
            "Jira create: %s поле %s (%s) осталось пустым — на экране создания: %s, схема: %s. "
            "Дозаполняю редактированием.",
            key, label, fid, "да" if on_screen else "НЕТ", schema or "неизвестна",
        )

        filled = False
        last_error = ""
        for candidate in _reference_candidates(item, schema):
            try:
                _jira_request(cfg, "PUT", f"/rest/api/2/issue/{key}",
                              json_body={"fields": {fid: candidate}})
            except HTTPException as e:
                logger.info("Jira create: %s формат для %s не принят (%s)", key, label, e.detail)
                last_error = str(e.detail)
                continue
            # Приняли запрос — убеждаемся, что значение действительно легло
            try:
                check = _jira_request(cfg, "GET", f"/rest/api/2/issue/{key}",
                                      params={"fields": fid})
            except HTTPException:
                filled = True
                break
            if _is_field_filled((check.get("fields", {}) or {}).get(fid)):
                logger.info("Jira create: %s поле %s заполнено форматом %s",
                            key, label, json.dumps(candidate, ensure_ascii=False)[:120])
                filled = True
                break

        if not filled:
            # Есть ли поле на экране, мы знаем только из createmeta — а он у нас часто 403.
            # Поэтому не гадаем о причине, а показываем ответ Jira как есть.
            known = bool(resolved.get("_by_id"))
            where = ("есть на экране создания, но Jira не приняла значение" if on_screen
                     else "нет на экране создания" if known else "Jira не приняла значение")
            warnings.append(
                f"«{label}» не проставилась в {key}: {where}"
                + (f" (ответ Jira: {last_error[:300]})" if last_error else "")
                + ". Проставьте вручную и покажите это сообщение администратору Jira."
            )


@router.post("/api/jira/create")
def create_defect(body: CreateDefectBody, db: Session = Depends(get_db)) -> dict:
    if not body.project.strip():
        raise HTTPException(400, "Укажите проект Jira")
    if not body.summary.strip():
        raise HTTPException(400, "Укажите название дефекта (summary)")

    from backend.api import jira_constants as JC
    is_sber911 = body.project.strip().upper() == JC.PROJECT_KEY

    cfg = _load_cfg(db)
    issuetype = body.issuetype.strip() or cfg["issuetype"]
    is_defect = issuetype.lower() in ("дефект", "bug", "баг", "ошибка") or issuetype == cfg["issuetype"]
    resolved = _resolve_fields(cfg, body.project.strip(), issuetype)

    description = body.description
    if body.description_is_markdown and description:
        description = _md_to_jira(description)

    fields: dict[str, Any] = {
        "project":     {"key": body.project.strip()},
        "issuetype":   {"name": resolved.get("_issuetype", issuetype)},
        "summary":     body.summary.strip()[:250],
        "description": description,
    }
    priority_name = body.priority.strip()
    if priority_name:
        if is_sber911 and priority_name in JC.PRIORITY:
            # id надёжнее имени — см. комментарий у jira_constants.PRIORITY
            fields["priority"] = {"id": JC.PRIORITY[priority_name]}
        else:
            fields["priority"] = {"name": priority_name}
    if body.labels:
        # Jira не принимает пробелы в лейблах
        fields["labels"] = [label_name(l) for l in body.labels if l.strip()]

    components = [c.strip() for c in body.components if c.strip()]
    if components:
        fields["components"] = [{"name": c} for c in components]
    if body.assignee.strip():
        fields["assignee"] = {"name": body.assignee.strip()}

    # ── SBER911: ИТ-услуга и КЭ + дефолты справочных полей ──
    if is_sber911:
        # ИТ-услуга и КЭ фиксированы для проекта и уходят ВСЕГДА, независимо от
        # выбранного компонента. Раньше КЭ бралась из справочника по компоненту,
        # и при незнакомом (или невыбранном) компоненте обязательное поле
        # не уходило вовсе.
        ke_field = resolved.get("ke", {}).get("id") or JC.FIELD_KE
        fields[ke_field] = _reference_value(resolved, ke_field, JC.KE)
        fields[JC.FIELD_IT_SERVICE] = _reference_value(
            resolved, JC.FIELD_IT_SERVICE, JC.IT_SERVICE,
        )

        if is_defect:
            for fid, value in JC.DEFAULT_FIELDS.items():
                fields.setdefault(fid, value)
            # Тип стенда — видимый выбор пользователя; если не выбрал, берём дефолт справочника
            stand_type_name = body.stand_type.strip() or JC.DEFAULT_STAND_TYPE
            if stand_type_name in JC.STAND_TYPE:
                fields[JC.FIELD_STAND_TYPE] = {"id": JC.STAND_TYPE[stand_type_name]}
        elif "security" in JC.DEFAULT_FIELDS:
            # Уровень доступа общий для проекта — нужен и задаче.
            fields.setdefault("security", JC.DEFAULT_FIELDS["security"])

    warnings: list[str] = []

    def _set_custom(logical: str, value: str, label: str):
        if not value.strip():
            return
        info = resolved.get(logical)
        if not info:
            warnings.append(f"«{label}» не установлено — поле не найдено в проекте")
            return
        v = value.strip()
        # select-поля требуют {"value": ...}; текстовые — строку
        fields[info["id"]] = {"value": v} if info["allowed"] else v

    if body.epic_key.strip():
        if "epic_link" in resolved:
            fields[resolved["epic_link"]["id"]] = body.epic_key.strip()
        elif is_sber911:
            fields[JC.FIELD_EPIC_LINK] = body.epic_key.strip()
        else:
            warnings.append("«Эпик» не установлен — поле Epic Link не найдено в проекте")
    # На SBER911 КЭ задана процессом и уже проставлена выше — извне её не меняем.
    if body.ke.strip() and not is_sber911:
        _set_custom("ke", body.ke, "КЭ")
    _set_custom("environment", body.environment, "Среда обнаружения")

    if resolved.get("_error"):
        logger.warning(
            "Jira create: createmeta недоступен (%s) — КЭ/эпик/среда для project=%s "
            "уходят по захардкоженным customfield id без проверки реальной схемы поля",
            resolved["_error"], body.project,
        )
    logger.info("Jira create: project=%s issuetype=%s итоговые fields=%s",
                body.project, fields.get("issuetype"), fields)

    created = _jira_request(cfg, "POST", "/rest/api/2/issue", json_body={"fields": fields})
    key = created.get("key", "")
    logger.info("Jira create: создан %s", key)

    # Дефект создаётся от имени сервисного PAT-токена — это не гарантирует, что
    # у пользователя есть право переводить его статус (Security Level, роль в
    # проекте и т.п.). Проверяем сразу и явно предупреждаем, а не оставляем
    # пользователя один на один с «дефект создан, но кнопок перехода нет».
    try:
        trans = _jira_request(cfg, "GET", f"/rest/api/2/issue/{key}/transitions")
        available = [t.get("name", "") for t in trans.get("transitions", [])]
        logger.info("Jira create: %s доступные переходы статуса: %s", key, available)
        if not available:
            warnings.append(
                f"Для {key} сразу после создания нет доступных переходов статуса — "
                "вероятно, ограничение по уровню доступа (Security Level) или роли в "
                "проекте у токена/пользователя. Проверьте у администратора Jira."
            )
    except HTTPException as e:
        logger.warning("Jira create: %s не удалось получить переходы статуса: %s", key, e.detail)

    # ИТ-услуга и КЭ обязательны по процессу, но Jira может принять создание и
    # молча их проигнорировать — проверяем факт и дозаполняем.
    if is_sber911 and key:
        _ensure_reference_fields(
            cfg, key, resolved,
            [(JC.FIELD_IT_SERVICE, "ИТ-услуга", JC.IT_SERVICE),
             (resolved.get("ke", {}).get("id") or JC.FIELD_KE, "КЭ", JC.KE)],
            warnings,
        )

    return {"status": "created", "key": key, "url": f"{cfg['base_url']}/browse/{key}",
            "warnings": warnings}


@router.post("/api/jira/attach/{key}")
async def attach_files(
    key: str,
    files: list[UploadFile] = File(default=[]),
    names: list[str] = Form(default=[]),
    db: Session = Depends(get_db),
) -> dict:
    """Прикладывает файлы к уже созданной задаче (дефекту или задаче из Jira tool).

    Описание ссылается на скриншоты разметкой !имя!, поэтому имя вложения
    должно совпасть с тем, что подставил /api/bugs/format — иначе Jira не
    свяжет картинку с разметкой и в описании останется голый текст.
    Имена приходят отдельным списком в том же порядке, что и файлы.
    """
    import requests

    key = key.strip()
    if not key:
        raise HTTPException(400, "Не указан ключ дефекта")
    real_files = [f for f in files if f and f.filename]
    if not real_files:
        return {"attached": [], "warnings": []}

    cfg = _load_cfg(db)
    url = cfg["base_url"] + f"/rest/api/2/issue/{key}/attachments"
    headers = {
        "Authorization": "Bearer " + _resolve_token(cfg),
        # Обязателен для загрузки вложений в Jira — без него 403 XSRF check failed.
        "X-Atlassian-Token": "no-check",
        "User-Agent": "Mozilla/5.0 (compatible; SimpleTest-QA/1.0)",
    }

    payload = []
    for i, f in enumerate(real_files):
        name = names[i] if i < len(names) and names[i].strip() else f.filename
        payload.append(("file", (name, await f.read(), f.content_type or "application/octet-stream")))

    logger.info("Jira attach: %s файлов=%s", key, [p[1][0] for p in payload])
    try:
        resp = requests.post(url, files=payload, headers=headers,
                             verify=cfg["ssl_verify"], timeout=60)
    except requests.exceptions.RequestException as e:
        logger.error("Jira attach: %s недоступна: %s", key, e)
        raise HTTPException(502, f"Не удалось приложить файлы к {key}: {str(e)[:200]}")

    if resp.status_code >= 400:
        logger.error("Jira attach: %s -> %s body=%s", key, resp.status_code, resp.text[:1000])
        # Дефект уже создан — падать целиком нельзя, иначе пользователь решит,
        # что регистрация не прошла, и заведёт дубль.
        return {"attached": [], "warnings": [
            f"{key} создана, но вложения не приложились ({resp.status_code}"
            f"{': слишком большой файл' if resp.status_code == 413 else ''}). Приложите файлы в Jira вручную."
        ]}

    # Успешный ответ — массив объектов вложений (id, filename, size, content).
    # Разбираем защитно: на нестандартный ответ (например, HTML от корп. прокси
    # с кодом 200) падать нельзя — дефект уже создан и файлы, скорее всего, легли.
    try:
        body = resp.json()
    except ValueError:
        body = None
    if not isinstance(body, list):
        logger.warning("Jira attach: %s неожиданный ответ: %s", key, resp.text[:300])
        return {"attached": [], "warnings": [
            f"{key} создана, файлы отправлены, но Jira вернула неожиданный ответ — "
            f"проверьте вложения в задаче."
        ]}

    attached = [a.get("filename", "") for a in body if isinstance(a, dict)]
    logger.info("Jira attach: %s приложено %s", key, attached)
    return {"attached": attached, "warnings": []}
