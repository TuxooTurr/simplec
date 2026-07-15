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

from fastapi import APIRouter, Depends, HTTPException, Query
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
    "stand":       ["стенд", "тестовый стенд"],
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
    headers = {"Accept": "application/json"}
    if auth is None:
        headers["Authorization"] = "Bearer " + _resolve_token(cfg)

    try:
        resp = requests.request(
            method, url,
            json=json_body, params=params, headers=headers,
            auth=auth, verify=cfg["ssl_verify"], timeout=timeout,
        )
    except requests.exceptions.SSLError as e:
        raise HTTPException(502, f"SSL-ошибка при подключении к Jira: {str(e)[:200]}. "
                                 "Отключите проверку сертификата в настройках Jira (корп. BIG IP).")
    except requests.exceptions.RequestException as e:
        raise HTTPException(502, f"Jira недоступна ({url}): {str(e)[:200]}")

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
        raise HTTPException(resp.status_code, f"Jira: {detail}")

    if resp.status_code == 204 or not resp.content:
        return {}
    return resp.json()


# ── Резолв кастомных полей по имени (кэш на процесс) ─────────────────────────

_fields_cache: dict[str, tuple[float, dict]] = {}
_FIELDS_TTL = 600  # 10 минут


def _resolve_fields(cfg: dict, project: str, issuetype: str) -> dict:
    """
    createmeta проекта → маппинг логических полей на id + allowedValues.
    Возвращает: {logical: {"id": "customfield_...", "name": "...", "allowed": [..]}}
    """
    cache_key = f"{cfg['base_url']}|{project}|{issuetype}"
    now = time.time()
    hit = _fields_cache.get(cache_key)
    if hit and now - hit[0] < _FIELDS_TTL:
        return hit[1]

    data = _jira_request(cfg, "GET", "/rest/api/2/issue/createmeta", params={
        "projectKeys": project,
        "expand": "projects.issuetypes.fields",
    })
    projects = data.get("projects", [])
    if not projects:
        raise HTTPException(404, f"Проект «{project}» не найден или нет прав на создание задач в нём")

    issuetypes = projects[0].get("issuetypes", [])
    it = next((t for t in issuetypes if t.get("name", "").lower() == issuetype.lower()), None)
    if it is None:
        # Bug как запасной вариант, иначе первый тип
        it = next((t for t in issuetypes if t.get("name", "").lower() in ("bug", "баг", "ошибка")),
                  issuetypes[0] if issuetypes else None)
    if it is None:
        raise HTTPException(404, f"В проекте «{project}» нет доступных типов задач")

    fields = it.get("fields", {})
    resolved: dict[str, Any] = {"_issuetype": it.get("name", issuetype), "_available": []}

    for fid, fdef in fields.items():
        fname = str(fdef.get("name", "")).strip()
        resolved["_available"].append(fname)
        low = fname.lower()
        for logical, hints in _FIELD_NAME_HINTS.items():
            if logical in resolved:
                continue
            if any(h in low for h in hints):
                allowed = [
                    v.get("value") or v.get("name") or ""
                    for v in fdef.get("allowedValues", []) or []
                ]
                resolved[logical] = {"id": fid, "name": fname, "allowed": [a for a in allowed if a]}

    _fields_cache[cache_key] = (now, resolved)
    return resolved


# ── Markdown → Jira wiki (минимально достаточно для отчёта) ──────────────────

def _md_to_jira(text: str) -> str:
    import re
    out = text
    out = re.sub(r"```(\w*)\n([\s\S]*?)```", lambda m: "{code}\n" + m.group(2) + "{code}", out)
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
    priority: str = ""         # имя приоритета Jira («Критический» и т.п.)
    labels: list[str] = Field(default_factory=list)
    epic_key: str = ""
    component: str = ""
    assignee: str = ""         # username
    ke: str = ""               # КЭ (CIXXXXXXXX)
    environment: str = ""      # среда обнаружения
    stand: str = ""            # стенд
    description_is_markdown: bool = True


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
    cfg = _load_cfg(db)
    priorities = _jira_request(cfg, "GET", "/rest/api/2/priority")
    components = _jira_request(cfg, "GET", f"/rest/api/2/project/{project}/components")
    fields = _resolve_fields(cfg, project, cfg["issuetype"])
    return {
        "priorities": [p.get("name", "") for p in priorities],
        "components": [c.get("name", "") for c in components],
        "issuetype":  fields.get("_issuetype", cfg["issuetype"]),
        "fields": {
            k: {"name": v["name"], "allowed": v["allowed"]}
            for k, v in fields.items() if not k.startswith("_")
        },
        "labels_presets": cfg["labels"],
    }


@router.get("/api/jira/epics")
def search_epics(project: str = Query(...), query: str = Query(""),
                 db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    q = query.replace('"', "").strip()
    jql = f'project = "{project}" AND issuetype = Epic'
    if q:
        jql += f' AND summary ~ "{q}*"'
    jql += " ORDER BY updated DESC"
    data = _jira_request(cfg, "GET", "/rest/api/2/search",
                         params={"jql": jql, "maxResults": 15, "fields": "summary"})
    return {"epics": [
        {"key": i.get("key", ""), "summary": i.get("fields", {}).get("summary", "")}
        for i in data.get("issues", [])
    ]}


@router.get("/api/jira/users")
def search_users(query: str = Query(...), db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    data = _jira_request(cfg, "GET", "/rest/api/2/user/search",
                         params={"username": query.strip(), "maxResults": 10})
    return {"users": [
        {"name": u.get("name", ""), "display": u.get("displayName", ""),
         "email": u.get("emailAddress", "")}
        for u in (data if isinstance(data, list) else [])
    ]}


# ── Routes: создание дефекта ─────────────────────────────────────────────────

@router.post("/api/jira/create")
def create_defect(body: CreateDefectBody, db: Session = Depends(get_db)) -> dict:
    if not body.project.strip():
        raise HTTPException(400, "Укажите проект Jira")
    if not body.summary.strip():
        raise HTTPException(400, "Укажите название дефекта (summary)")

    cfg = _load_cfg(db)
    resolved = _resolve_fields(cfg, body.project.strip(), cfg["issuetype"])

    description = body.description
    if body.description_is_markdown and description:
        description = _md_to_jira(description)

    fields: dict[str, Any] = {
        "project":     {"key": body.project.strip()},
        "issuetype":   {"name": resolved.get("_issuetype", cfg["issuetype"])},
        "summary":     body.summary.strip()[:250],
        "description": description,
    }
    if body.priority.strip():
        fields["priority"] = {"name": body.priority.strip()}
    if body.labels:
        # Jira не принимает пробелы в лейблах
        fields["labels"] = [l.strip().replace(" ", "_") for l in body.labels if l.strip()]
    if body.component.strip():
        fields["components"] = [{"name": body.component.strip()}]
    if body.assignee.strip():
        fields["assignee"] = {"name": body.assignee.strip()}

    def _set_custom(logical: str, value: str):
        info = resolved.get(logical)
        if not info or not value.strip():
            return
        v = value.strip()
        # select-поля требуют {"value": ...}; текстовые — строку
        fields[info["id"]] = {"value": v} if info["allowed"] else v

    if body.epic_key.strip() and "epic_link" in resolved:
        fields[resolved["epic_link"]["id"]] = body.epic_key.strip()
    _set_custom("ke", body.ke)
    _set_custom("environment", body.environment)
    _set_custom("stand", body.stand)

    created = _jira_request(cfg, "POST", "/rest/api/2/issue", json_body={"fields": fields})
    key = created.get("key", "")
    return {"status": "created", "key": key, "url": f"{cfg['base_url']}/browse/{key}"}
