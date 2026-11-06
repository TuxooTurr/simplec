"""
Трекинг AQA — развитие автотестов одной вкладкой.

  • Bitbucket (stash): коммиты репозитория автотестов — за сегодня, за 7 дней (с сегодняшним), всего, по дням за две
    недели, последние и авторы недели; по коммиту — файлы и строки добавлено/удалено. Ветка выбирается (по умолчанию — ветка по умолчанию репозитория); считаются
    коммиты, как их показывает Bitbucket (с merge-коммитами).
  • Allure TestOps: запуски проекта — сколько сегодня, последние с кейсами по статусам, кейсы всех запусков за сегодня;
    по запуску — подробности: кейсы с результатами.
  • Роадмап: эпики AQA (ключи в настройках) с задачами и дефектами — их стори/задачи/дефекты по Epic Link и задачи,
    связанные с эпиком. Даты для таймлайна — плановое начало и плановое окончание (поля Jira находятся по названию;
    нет поля — создание и срок duedate) и фактическое закрытие (дата решения; нет — когда статус стал «готово»).

Источники задаются ссылками, как их копируют из браузера:
  https://stash.sigma.sbrf.ru/projects/SBER911/repos/sber911-aqa/browse
  https://testops.sigma.sbrf.ru/project/2414/test-cases
Маркер Bitbucket выпускается при входе логином Jira (corp_auth) или кнопкой в настройках — по логину/паролю Сигмы;
API-токен TestOps вставляется в настройках (по паролю TestOps токены не выдаёт). Секреты — в metrics_settings, как
маркеры Jira, наружу — маской.

  GET  /api/aqa/settings                     — ссылки, эпики, есть ли маркеры
  PUT  /api/aqa/settings                     — сохранить (маска вместо маркера — оставить прежний)
  POST /api/aqa/bitbucket/token-from-login   — маркер Bitbucket по логину/паролю
  GET  /api/aqa/branches?filter=             — ветки репозитория
  GET  /api/aqa/commits?branch=&refresh=     — коммиты ветки (пусто — ветка по умолчанию)
  GET  /api/aqa/testops?refresh=             — запуски
  GET  /api/aqa/testops/launch/{id}          — запуск подробно: кейсы с результатами
  GET  /api/aqa/testops/result/{id}          — результат кейса: описание, ошибка, шаги (какой упал), вложения
  GET  /api/aqa/testops/attachment/{id}      — вложение текстом: тело запроса и ответа, логи
  POST /api/aqa/testops/behaviors            — эпик, фича и стори результатов: группировка как Behaviors в Allure
  GET  /api/aqa/commit/{hash}                — коммит подробно: файлы, строки +/−, свод по типам и расширениям
  GET  /api/aqa/commit/{hash}/diff?path=     — файл коммита построчно: «было» слева, «стало» справа
  GET  /api/aqa/roadmap?refresh=             — эпики с задачами; Jira недоступна — последний снимок
  GET  /api/aqa/jenkins/job                  — джоб автотестов: параметры запуска и последние сборки
  POST /api/aqa/jenkins/run                  — запустить джоб с параметрами
  GET  /api/aqa/jenkins/queue/{id}           — что с запуском в очереди: ждёт, начался (номер сборки) или отменён
  GET  /api/aqa/issue/{key}                  — задача для окна правки: описание, что можно менять, приоритеты
  PUT  /api/aqa/issue/{key}                  — записать изменения в Jira (название, описание, приоритет, исполнитель, плановые даты)

Задачи эпика заводятся через POST /api/jira/create (та же форма, что в Jira tool), а статус меняется переходами
/api/jira/tool/transitions и /transition. Здесь — только то, чего у них нет: правка полей и запись плановых дат.

Запуск автотестов — джоб Jenkins по ссылке из настроек. Параметры не зашиты в коде: форма строится из описания джоба,
новый параметр в Jenkinsfile появляется в ней сам. Вход — логин и API-токен Jenkins (Basic), запуск идёт от их имени.

Снимок роадмапа (data/aqa_roadmap.json) обновляется при каждой удачной загрузке и входит в резервную копию
(раздел «Трекинг AQA») вместе с эпиками из настроек: после восстановления роадмап виден и без Jira.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api import jira_defects
from backend.api.jira_defects import _MASK, _get, _set
from db.postgres import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

K_BB_URL, K_BB_TOKEN = "aqa_bitbucket_url", "aqa_bitbucket_token"
K_TO_URL, K_TO_TOKEN = "aqa_testops_url", "aqa_testops_token"
K_JK_URL, K_JK_USER, K_JK_TOKEN = "aqa_jenkins_url", "aqa_jenkins_user", "aqa_jenkins_token"
K_EPICS = "aqa_epics"
# Ссылки по умолчанию — пока настройку не сохраняли. Стёртая в настройках ссылка хранится пустой строкой и остаётся пустой.
DEFAULT_BB_URL = "https://stash.sigma.sbrf.ru/projects/SBER911/repos/sber911-aqa/browse"
DEFAULT_TO_URL = "https://testops.sigma.sbrf.ru/project/2414/test-cases"
DEFAULT_JK_URL = "https://sber911-ci.ci.jenkins.sberbank.ru/job/sber911-ci/job/sber911-backend/job/AQA/job/AQA_TEST/"
# Эпики AQA, которые на роадмапе всегда: стоят первыми, убрать их нельзя ни с графика, ни в настройках.
PINNED_EPICS = ["SBER911-29998", "SBER911-30133", "SBER911-30135"]
MAX_EPICS = 5                          # своих эпиков, сверх закреплённых
CACHE_TTL = 300                        # 5 минут: вкладку открывают часто, а полный счёт коммитов — сотни запросов
TODAY_STATS_LIMIT = 30                 # запусков за сегодня, по которым суммируются кейсы
RECENT_LAUNCHES = 12                   # последних запусков в виджете (у каждого — кейсы по статусам)
RECENT_COMMITS = 10
DAILY_DAYS = 14                        # столбики коммитов по дням
MAX_RESULTS = 2000                     # кейсов в подробностях запуска
MAX_FILES = 1000                       # файлов в подробностях коммита
# Последний загруженный роадмап — снимок: попадает в резервную копию (раздел «Трекинг AQA») и показывается,
# когда Jira недоступна.
SNAPSHOT_FILE = Path(__file__).resolve().parents[2] / "data" / "aqa_roadmap.json"

_BB_RE = re.compile(r"^(https?://.+?)/projects/([^/]+)/repos/([^/?#]+)", re.I)
_TO_RE = re.compile(r"^(https?://.+?)/project/(\d+)", re.I)
_JK_RE = re.compile(r"^(https?://.+?)((?:/job/[^/?#]+)+)", re.I)
_DEFECT_TYPES = {"дефект", "bug", "баг", "ошибка"}


# ── Ссылки → адреса ──────────────────────────────────────────────────────────

def parse_bitbucket(url: str) -> Optional[dict]:
    """Ссылка на репозиторий в Bitbucket → адрес сервера, проект, репозиторий; не похожа — None."""
    m = _BB_RE.match(url.strip())
    return {"base_url": m.group(1).rstrip("/"), "project": m.group(2), "repo": m.group(3)} if m else None


def parse_testops(url: str) -> Optional[dict]:
    """Ссылка на проект в Allure TestOps → адрес сервера и id проекта; не похожа — None."""
    m = _TO_RE.match(url.strip())
    return {"base_url": m.group(1).rstrip("/"), "project_id": int(m.group(2))} if m else None


def parse_jenkins(url: str) -> Optional[dict]:
    """Ссылка на джоб Jenkins → адрес сервера, путь джоба и его имя; не похожа — None."""
    m = _JK_RE.match(url.strip())
    return {"base_url": m.group(1).rstrip("/"), "job_path": m.group(2), "job": m.group(2).rsplit("/", 1)[-1]} if m else None


def _own_epics(db: Session) -> list[str]:
    """Эпики из настроек, без закреплённых."""
    try:
        v = json.loads(_get(db, K_EPICS, "[]"))
    except ValueError:
        return []
    keys = [str(x).strip().upper() for x in v if str(x).strip()] if isinstance(v, list) else []
    return [k for k in keys if k not in PINNED_EPICS][:MAX_EPICS]


def _epics(db: Session) -> list[str]:
    return PINNED_EPICS + _own_epics(db)


def _ssl_verify(db: Session) -> Any:
    # Корпоративные серверы за тем же прокси, что и Jira: настройку проверки сертификата берём оттуда.
    return jira_defects._load_cfg(db)["ssl_verify"]


def bb_cfg(db: Session) -> dict:
    url = _get(db, K_BB_URL, DEFAULT_BB_URL)
    p = parse_bitbucket(url) or {"base_url": "", "project": "", "repo": ""}
    return {**p, "url": url, "token": _get(db, K_BB_TOKEN), "token_path": "", "ssl_verify": _ssl_verify(db)}


def to_cfg(db: Session) -> dict:
    url = _get(db, K_TO_URL, DEFAULT_TO_URL)
    p = parse_testops(url) or {"base_url": "", "project_id": 0}
    return {**p, "url": url, "token": _get(db, K_TO_TOKEN), "ssl_verify": _ssl_verify(db)}


def jk_cfg(db: Session) -> dict:
    url = _get(db, K_JK_URL, DEFAULT_JK_URL)
    p = parse_jenkins(url) or {"base_url": "", "job_path": "", "job": ""}
    return {**p, "url": url, "user": _get(db, K_JK_USER), "token": _get(db, K_JK_TOKEN), "ssl_verify": _ssl_verify(db)}


# ── HTTP ─────────────────────────────────────────────────────────────────────

def _http(name: str, method: str, url: str, verify: Any, *, token: str = "", auth: Optional[tuple] = None,
          params: Optional[dict] = None, json_body: Any = None, data: Optional[dict] = None, timeout: int = 30,
          text: bool = False, raw: bool = False, accept: str = "application/json") -> Any:
    """Запрос к Bitbucket, TestOps или Jenkins; ошибки — понятным текстом с именем системы, как у Jira.
    raw — вернуть сам ответ (нужны заголовки)."""
    import requests
    headers = {"Accept": accept, "User-Agent": "Mozilla/5.0 (compatible; Loom-QA/1.0)"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        resp = requests.request(method, url, params=params, json=json_body, data=data, headers=headers,
                                auth=auth, verify=verify, timeout=timeout)
    except requests.exceptions.SSLError as e:
        raise HTTPException(502, f"{name}: SSL-ошибка ({str(e)[:150]}). Отключите проверку сертификата в настройках Jira")
    except requests.exceptions.RequestException as e:
        raise HTTPException(502, f"{name} недоступен ({url}): {str(e)[:200]}")
    if resp.status_code == 401:
        raise HTTPException(401, f"{name}: токен недействителен или истёк — обновите его в настройках вкладки")
    if resp.status_code == 403:
        raise HTTPException(403, f"{name}: нет прав (403)")
    if resp.status_code == 404:
        raise HTTPException(404, f"{name}: не найдено (404) — проверьте ссылку в настройках вкладки")
    if resp.status_code >= 400:
        raise HTTPException(502, f"{name}: ошибка {resp.status_code}: {resp.text[:300]}")
    if raw:
        return resp
    if text:
        return resp.text
    try:
        return resp.json() if resp.text.strip() else {}
    except ValueError:
        raise HTTPException(502, f"{name}: ответ не JSON — проверьте адрес ({url})")


_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, refresh: bool, fn):
    hit = _cache.get(key)
    if hit and not refresh and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


def _day_start(days_ago: int = 0) -> datetime:
    return datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _iso(ms: Any) -> str:
    try:
        return datetime.fromtimestamp(int(ms) / 1000).isoformat(timespec="seconds")
    except (TypeError, ValueError, OSError):
        return ""


# ── Bitbucket ────────────────────────────────────────────────────────────────

def bb_whoami(cfg: dict) -> str:
    """Чей маркер: имя пользователя Bitbucket (пусто — маркер не принят)."""
    return str(_http("Bitbucket", "GET", f"{cfg['base_url']}/plugins/servlet/applinks/whoami", cfg["ssl_verify"],
                     token=cfg["token"], text=True)).strip()


class TokenFromLoginBody(BaseModel):
    login: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    base_url: str = ""


def token_from_login(body: TokenFromLoginBody, db: Session) -> dict:
    """Маркер Bitbucket (HTTP access token, только чтение, 180 дней) по логину/паролю Сигмы. Пароль не хранится."""
    cfg = bb_cfg(db)
    if not cfg["base_url"]:
        raise HTTPException(400, "Ссылка на репозиторий Bitbucket не задана — укажите её в настройках вкладки «Трекинг AQA»")
    login = body.login.strip()
    try:
        r = _http("Bitbucket", "PUT", f"{cfg['base_url']}/rest/access-tokens/1.0/users/{login.lower()}", cfg["ssl_verify"],
                  auth=(login, body.password),
                  json_body={"name": f"Loom {time.strftime('%Y-%m-%d %H:%M')}",
                             "permissions": ["PROJECT_READ", "REPO_READ"], "expiryDays": 180})
    except HTTPException as e:
        if e.status_code in (401, 403):
            raise HTTPException(e.status_code, "Bitbucket не выдал маркер: неверный логин/пароль или выдача маркеров закрыта. "
                                               "Создайте его в профиле Bitbucket → «HTTP access tokens» и вставьте в настройках вкладки.")
        raise
    token = r.get("token", "")
    if not token:
        raise HTTPException(502, "Bitbucket не вернул маркер — создайте его в профиле Bitbucket и вставьте в настройках вкладки")
    _set(db, K_BB_TOKEN, token, "Bitbucket HTTP access token (секрет)")
    db.commit()
    return {"status": "ok", "token": _MASK, "expires_days": 180}


def _repo_url(cfg: dict) -> str:
    return f"{cfg['base_url']}/rest/api/1.0/projects/{cfg['project']}/repos/{cfg['repo']}"


def bb_branches(cfg: dict, filter_text: str = "") -> dict:
    """Ветки репозитория: недавно изменённые сверху, до 100; filter — по части имени. default — ветка по умолчанию."""
    params: dict[str, Any] = {"limit": 100, "orderBy": "MODIFICATION", "details": "false"}
    if filter_text.strip():
        params["filterText"] = filter_text.strip()
    data = _http("Bitbucket", "GET", f"{_repo_url(cfg)}/branches", cfg["ssl_verify"], token=cfg["token"], params=params)
    branches = [{"name": str(b.get("displayId") or ""), "default": bool(b.get("isDefault"))}
                for b in data.get("values") or [] if b.get("displayId")]
    default = next((b["name"] for b in branches if b["default"]), "")
    if not default:
        try:
            d = _http("Bitbucket", "GET", f"{_repo_url(cfg)}/branches/default", cfg["ssl_verify"], token=cfg["token"])
            default = str(d.get("displayId") or "")
        except HTTPException:
            default = ""
    return {"branches": branches, "default": default, "more": not data.get("isLastPage", True)}


def _ref(branch: str) -> str:
    b = branch.strip()
    return b if b.startswith("refs/") else f"refs/heads/{b}"


def _commit_view(c: dict, cfg: dict, ts: int) -> dict:
    author = c.get("author") or {}
    return {"id": c.get("displayId") or str(c.get("id", ""))[:11], "hash": str(c.get("id", "")), "message": str(c.get("message", "")).split("\n")[0][:200],
            "author": author.get("displayName") or author.get("name") or "", "date": _iso(ts),
            "url": f"{cfg['base_url']}/projects/{cfg['project']}/repos/{cfg['repo']}/commits/{c.get('id', '')}"}


def bb_commits(cfg: dict, branch: str = "") -> dict:
    """Коммиты ветки (пусто — по умолчанию): сегодня, 7 дней, всего, по дням за две недели, последние, авторы недели.
    Всего — по всем страницам (до 1000 на страницу)."""
    url = f"{_repo_url(cfg)}/commits"
    today0, week0 = _ms(_day_start()), _ms(_day_start(6))
    day0 = _day_start(DAILY_DAYS - 1)
    daily = [0] * DAILY_DAYS
    authors: dict[str, int] = {}
    total = today = week = 0
    recent: list[dict] = []
    start, pages, truncated = 0, 0, False
    base_params: dict[str, Any] = {"limit": 1000}
    if branch.strip():
        base_params["until"] = _ref(branch)
    while True:
        data = _http("Bitbucket", "GET", url, cfg["ssl_verify"], token=cfg["token"], params={**base_params, "start": start})
        for c in data.get("values") or []:
            ts = int(c.get("committerTimestamp") or c.get("authorTimestamp") or 0)
            total += 1
            today += ts >= today0
            if ts >= week0:
                week += 1
                a = c.get("author") or {}
                name = a.get("displayName") or a.get("name") or "—"
                authors[name] = authors.get(name, 0) + 1
            if ts:
                n = (datetime.fromtimestamp(ts / 1000).date() - day0.date()).days
                if 0 <= n < DAILY_DAYS:
                    daily[n] += 1
            if len(recent) < RECENT_COMMITS:
                recent.append(_commit_view(c, cfg, ts))
        pages += 1
        if data.get("isLastPage", True) or data.get("nextPageStart") is None:
            break
        if pages >= 100:                            # 100 000 коммитов — дальше «всего» не точное
            truncated = True
            break
        start = int(data["nextPageStart"])
    return {"today": today, "week": week, "total": total, "totalTruncated": truncated,
            "last": recent[0] if recent else None, "recent": recent,
            "daily": [{"date": (day0 + timedelta(days=i)).date().isoformat(), "count": daily[i]} for i in range(DAILY_DAYS)],
            "authors": [{"name": k, "count": v} for k, v in sorted(authors.items(), key=lambda x: (-x[1], x[0]))],
            "branch": branch.strip(),
            "repoUrl": f"{cfg['base_url']}/projects/{cfg['project']}/repos/{cfg['repo']}/browse"
                       + (f"?at={_ref(branch)}" if branch.strip() else "")}


_CHANGE_TYPE = {"ADD": "added", "MODIFY": "modified", "DELETE": "deleted", "MOVE": "moved", "COPY": "copied"}


def _ext(path: str) -> str:
    """Расширение файла для свода: «java», «yml»; нет расширения — имя файла (Dockerfile, Jenkinsfile)."""
    name = path.rsplit("/", 1)[-1]
    return name.rsplit(".", 1)[-1].lower() if "." in name.strip(".") else name


def bb_commit(cfg: dict, commit_id: str) -> dict:
    """Коммит подробно: сообщение, автор, файлы (добавлен / изменён / удалён / перенесён) и строки +/− по каждому —
    из diff без контекста. Свод: файлов, строк добавлено и удалено, по типам изменений и по расширениям.
    У merge-коммита изменения — относительно первого родителя, как их показывает Bitbucket. Большой diff Bitbucket
    обрезает (truncated) — тогда строки посчитаны не все, это помечается."""
    base = f"{_repo_url(cfg)}/commits/{commit_id}"
    c = _http("Bitbucket", "GET", base, cfg["ssl_verify"], token=cfg["token"])
    ch = _http("Bitbucket", "GET", f"{base}/changes", cfg["ssl_verify"], token=cfg["token"], params={"limit": MAX_FILES})
    diff = _http("Bitbucket", "GET", f"{base}/diff", cfg["ssl_verify"], token=cfg["token"],
                 params={"contextLines": 0, "withComments": "false"}, timeout=60)

    files: dict[str, dict] = {}
    for x in ch.get("values") or []:
        path = str((x.get("path") or {}).get("toString") or "")
        if not path:
            continue
        files[path] = {"path": path, "from": str((x.get("srcPath") or {}).get("toString") or ""),
                       "type": _CHANGE_TYPE.get(str(x.get("type", "")).upper(), "modified"),
                       "added": 0, "removed": 0, "binary": False}
    truncated = bool(diff.get("truncated"))
    for d in diff.get("diffs") or []:
        path = str((d.get("destination") or d.get("source") or {}).get("toString") or "")
        if not path:
            continue
        f = files.setdefault(path, {"path": path, "from": "", "type": "modified", "added": 0, "removed": 0, "binary": False})
        f["binary"] = bool(d.get("binary"))
        truncated |= bool(d.get("truncated"))
        for h in d.get("hunks") or []:
            truncated |= bool(h.get("truncated"))
            for seg in h.get("segments") or []:
                kind = str(seg.get("type", "")).upper()
                if kind in ("ADDED", "REMOVED"):
                    f["added" if kind == "ADDED" else "removed"] += len(seg.get("lines") or [])

    rows = sorted(files.values(), key=lambda f: (-(f["added"] + f["removed"]), f["path"]))
    by_type: dict[str, int] = {}
    by_ext: dict[str, dict] = {}
    for f in rows:
        by_type[f["type"]] = by_type.get(f["type"], 0) + 1
        e = by_ext.setdefault(_ext(f["path"]), {"ext": _ext(f["path"]), "files": 0, "added": 0, "removed": 0})
        e["files"] += 1
        e["added"] += f["added"]
        e["removed"] += f["removed"]
    author = c.get("author") or {}
    ts = int(c.get("authorTimestamp") or c.get("committerTimestamp") or 0)
    return {**_commit_view(c, cfg, ts), "message": str(c.get("message", "")).strip(),
            "email": str(author.get("emailAddress") or ""), "merge": len(c.get("parents") or []) > 1,
            "files": rows, "filesMore": not ch.get("isLastPage", True), "truncated": truncated,
            "totals": {"files": len(rows), "added": sum(f["added"] for f in rows), "removed": sum(f["removed"] for f in rows),
                       "byType": by_type},
            "byExt": sorted(by_ext.values(), key=lambda e: (-(e["added"] + e["removed"]), e["ext"]))}


MAX_DIFF_ROWS = 3000                   # строк «было / стало» на файл в окне коммита
DIFF_CONTEXT = 3                       # строк вокруг изменений


def side_by_side(diff: dict) -> list[list[dict]]:
    """Diff файла из Bitbucket → куски строк «было / стало» рядом: [[{l, r}, …], …]. l / r — {n, text, type} или None.
    Неизменённые строки — с обеих сторон; удалённые и добавленные подряд встают парами (было слева, стало справа),
    лишние — против пустоты."""
    out: list[list[dict]] = []
    for h in diff.get("hunks") or []:
        rows: list[dict] = []
        removed: list[dict] = []
        added: list[dict] = []

        def flush():
            for k in range(max(len(removed), len(added))):
                rows.append({"l": removed[k] if k < len(removed) else None, "r": added[k] if k < len(added) else None})
            removed.clear()
            added.clear()

        for seg in h.get("segments") or []:
            kind = str(seg.get("type", "")).upper()
            for ln in seg.get("lines") or []:
                text = str(ln.get("line", ""))
                if kind == "REMOVED":
                    removed.append({"n": ln.get("source"), "text": text, "type": "removed"})
                elif kind == "ADDED":
                    added.append({"n": ln.get("destination"), "text": text, "type": "added"})
                else:
                    flush()
                    rows.append({"l": {"n": ln.get("source"), "text": text, "type": "context"},
                                 "r": {"n": ln.get("destination"), "text": text, "type": "context"}})
        flush()
        if rows:
            out.append(rows)
    return out


def bb_file_diff(cfg: dict, commit_id: str, path: str, src_path: str = "") -> dict:
    """Файл коммита построчно «было / стало» (DIFF_CONTEXT строк вокруг изменений). Двоичный — без строк;
    больше MAX_DIFF_ROWS строк — обрезается, это помечается."""
    enc = "/".join(quote(p, safe="") for p in path.split("/"))
    params: dict[str, Any] = {"contextLines": DIFF_CONTEXT, "withComments": "false"}
    if src_path:
        params["srcPath"] = src_path
    data = _http("Bitbucket", "GET", f"{_repo_url(cfg)}/commits/{commit_id}/diff/{enc}", cfg["ssl_verify"],
                 token=cfg["token"], params=params, timeout=60)
    diffs = data.get("diffs") or []
    d = diffs[0] if diffs else {}
    hunks = side_by_side(d)
    total, cut, truncated = 0, [], bool(data.get("truncated") or d.get("truncated"))
    for h in hunks:
        if total + len(h) > MAX_DIFF_ROWS:
            cut.append(h[:MAX_DIFF_ROWS - total])
            truncated = True
            break
        cut.append(h)
        total += len(h)
    return {"path": path, "binary": bool(d.get("binary")), "hunks": [h for h in cut if h], "truncated": truncated}


# ── Allure TestOps ───────────────────────────────────────────────────────────

_jwt: dict[str, tuple[float, str]] = {}


def _testops_jwt(cfg: dict) -> str:
    """API-токен TestOps → JWT (живёт ограниченно — держим до истечения минус минута)."""
    hit = _jwt.get(cfg["token"])
    if hit and time.time() < hit[0]:
        return hit[1]
    r = _http("Allure TestOps", "POST", f"{cfg['base_url']}/api/uaa/oauth/token", cfg["ssl_verify"],
              data={"grant_type": "apitoken", "scope": "openid", "token": cfg["token"]})
    jwt = r.get("access_token", "")
    if not jwt:
        raise HTTPException(401, "Allure TestOps не принял API-токен — создайте новый в профиле TestOps → API tokens")
    _jwt[cfg["token"]] = (time.time() + max(60, int(r.get("expires_in") or 3600) - 60), jwt)
    return jwt


def _stats(raw: Any) -> dict[str, int]:
    """Статистика запуска → {passed, failed, broken, skipped, unknown…}: TestOps отдаёт список [{status, count}]."""
    out: dict[str, int] = {}
    items = raw if isinstance(raw, list) else (raw or {}).get("content") or []
    for x in items:
        st = str((x or {}).get("status") or "unknown").lower()
        out[st] = out.get(st, 0) + int((x or {}).get("count") or 0)
    return out


def _created(launch: dict) -> int:
    return int(launch.get("createdDate") or launch.get("created_date") or launch.get("createdAt") or 0)


def testops_launches(cfg: dict) -> dict:
    jwt = _testops_jwt(cfg)
    base, verify = cfg["base_url"], cfg["ssl_verify"]

    def page(n: int) -> list[dict]:
        r = _http("Allure TestOps", "GET", f"{base}/api/rs/launch", verify, token=jwt,
                  params={"projectId": cfg["project_id"], "page": n, "size": 50, "sort": "createdDate,DESC"})
        return r.get("content") or [] if isinstance(r, dict) else []

    today0 = _ms(_day_start())
    launches: list[dict] = []
    for n in range(10):                              # 500 последних запусков — за сегодня хватит с запасом
        got = page(n)
        launches.extend(got)
        if len(got) < 50 or (got and _created(got[-1]) < today0):
            break
    launches.sort(key=_created, reverse=True)
    todays = [x for x in launches if _created(x) >= today0]

    got_stats: dict[Any, dict[str, int]] = {}

    def stat(launch_id: Any) -> dict[str, int]:
        if launch_id not in got_stats:
            got_stats[launch_id] = _stats(_http("Allure TestOps", "GET", f"{base}/api/rs/launch/{launch_id}/statistic", verify, token=jwt))
        return got_stats[launch_id]

    today_stats: dict[str, int] = {}
    for x in todays[:TODAY_STATS_LIMIT]:
        for k, v in stat(x["id"]).items():
            today_stats[k] = today_stats.get(k, 0) + v
    recent = [_launch_view(x, base, stat(x["id"])) for x in launches[:RECENT_LAUNCHES]]
    return {"todayLaunches": len(todays), "todayStats": today_stats,
            "todayStatsPartial": len(todays) > TODAY_STATS_LIMIT, "last": recent[0] if recent else None, "recent": recent,
            "projectUrl": f"{base}/project/{cfg['project_id']}/launches"}


def _launch_view(x: dict, base: str, stats: dict[str, int]) -> dict:
    return {"id": x.get("id"), "name": x.get("name", ""), "date": _iso(_created(x)), "closed": bool(x.get("closed")),
            "url": f"{base}/launch/{x.get('id')}", "stats": stats}


def _names(raw: Any) -> list[str]:
    """Теги и окружение TestOps приходят списком объектов {name} или {name, value}."""
    out = []
    for t in raw if isinstance(raw, list) else []:
        if isinstance(t, dict):
            name, value = str(t.get("name") or t.get("key") or ""), str(t.get("value") or "")
            if name or value:
                out.append(f"{name}: {value}" if name and value else name or value)
        elif t:
            out.append(str(t))
    return out


def testops_launch(cfg: dict, launch_id: int) -> dict:
    """Запуск подробно: сведения, кейсы по статусам и результаты кейсов (до MAX_RESULTS) — упавшие сверху."""
    jwt = _testops_jwt(cfg)
    base, verify = cfg["base_url"], cfg["ssl_verify"]
    x = _http("Allure TestOps", "GET", f"{base}/api/rs/launch/{launch_id}", verify, token=jwt) or {}
    stats = _stats(_http("Allure TestOps", "GET", f"{base}/api/rs/launch/{launch_id}/statistic", verify, token=jwt))
    try:
        env = _names(_http("Allure TestOps", "GET", f"{base}/api/rs/launch/{launch_id}/env", verify, token=jwt))
    except HTTPException:
        env = []                                     # окружения может не быть или старый TestOps его не отдаёт
    results: list[dict] = []
    page, starts, stops = 0, [], []
    while len(results) < MAX_RESULTS:
        r = _http("Allure TestOps", "GET", f"{base}/api/rs/testresult", verify, token=jwt,
                  params={"launchId": launch_id, "page": page, "size": 100})
        content = (r.get("content") or []) if isinstance(r, dict) else []
        for t in content:
            st, sp = int(t.get("start") or 0), int(t.get("stop") or 0)
            if st:
                starts.append(st)
            if sp:
                stops.append(sp)
            tc = t.get("testCaseId")
            results.append({
                "id": t.get("id"), "name": str(t.get("name") or t.get("fullName") or ""),
                "status": str(t.get("status") or "unknown").lower(),
                "duration": int(t.get("duration") or (sp - st if st and sp else 0)),
                "message": str(t.get("message") or t.get("statusMessage") or "")[:500],
                "assignee": str(t.get("assignee") or t.get("createdBy") or ""),
                "testCaseId": tc,
                "url": f"{base}/project/{cfg['project_id']}/test-cases/{tc}" if tc else "",
                # Эпик, фича и стори, если сервер отдал их в списке; None — спросить по результату (/behaviors).
                "behavior": behavior_of(t) if t.get("labels") or t.get("customFields") else None,
            })
        page += 1
        if not content or page >= int((r or {}).get("totalPages") or 0):
            break
    total = sum(stats.values()) or len(results)
    order = {"failed": 0, "broken": 1, "unknown": 2, "skipped": 3, "passed": 4}
    results.sort(key=lambda t: (order.get(t["status"], 2), t["name"].lower()))
    return {
        **_launch_view(x or {"id": launch_id}, base, stats),
        "createdBy": str(x.get("createdBy") or ""),
        "tags": _names(x.get("tags")), "env": env,
        "duration": (max(stops) - min(starts)) if starts and stops else 0,
        "results": results[:MAX_RESULTS], "resultsTotal": total, "resultsPartial": total > len(results),
    }


# ── Результат кейса: шаги, вложения, поведения ───────────────────────────────

MAX_STEPS = 2000                       # шагов в ответе: защита от зацикленного отчёта
MAX_ATTACHMENT = 1_000_000             # символов вложения в окне
MAX_BEHAVIOR_FETCH = 600               # результатов, которые спрашиваем поштучно ради группировки
_BEHAVIOR_WORKERS = 8
_FAILED = ("failed", "broken")
_TEXT_TYPES = ("text/", "json", "xml", "yaml", "csv", "html", "javascript")
_BEHAVIOR_KEYS = ("epic", "feature", "story")
# Адреса шагов отличаются по версиям TestOps: берём первый ответивший.
_STEP_PATHS = ("execution", "scenario")


def behavior_of(raw: dict) -> dict:
    """Эпик, фича и стори результата: метки Allure {name, value} или поля TestOps {customField: {name}, name}."""
    out: dict[str, str] = {}
    for lb in raw.get("labels") or []:
        if isinstance(lb, dict) and str(lb.get("name") or "").lower() in _BEHAVIOR_KEYS and lb.get("value"):
            out.setdefault(str(lb["name"]).lower(), str(lb["value"]))
    for cf in raw.get("customFields") or []:
        name = str(((cf or {}).get("customField") or {}).get("name") or "").lower() if isinstance(cf, dict) else ""
        if name in _BEHAVIOR_KEYS and cf.get("name"):
            out.setdefault(name, str(cf["name"]))
    return out


def _attachment(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict) or not raw.get("id"):
        return None
    return {"id": raw["id"], "name": str(raw.get("name") or raw.get("originalFileName") or f"Вложение {raw['id']}"),
            "type": str(raw.get("contentType") or raw.get("type") or ""), "size": int(raw.get("contentLength") or raw.get("size") or 0)}


def _attachments(raw: Any) -> list[dict]:
    items = raw.values() if isinstance(raw, dict) else raw if isinstance(raw, list) else []
    return [a for a in map(_attachment, items) if a]


def _unflatten(data: dict) -> list[dict]:
    """Шаги плоским словарём {root: {children: [id]}, scenarioSteps: {id: шаг}, attachments: {id: вложение}} → дерево."""
    steps = data.get("scenarioSteps") or {}
    atts = data.get("attachments") or {}

    def node(i: Any, depth: int) -> Optional[dict]:
        s = steps.get(str(i)) or steps.get(i)
        if not isinstance(s, dict) or depth > 30:
            return None
        a = atts.get(str(s.get("attachmentId"))) or atts.get(s.get("attachmentId")) if s.get("attachmentId") else None
        kids = [k for k in (node(c, depth + 1) for c in s.get("children") or []) if k]
        return {**s, "steps": kids, "attachments": [a] if a else []}
    return [n for n in (node(i, 0) for i in ((data.get("root") or {}).get("children") or [])) if n]


def _step(raw: dict, budget: list[int], depth: int = 0) -> Optional[dict]:
    if budget[0] <= 0 or depth > 30:
        return None
    budget[0] -= 1
    kids = [k for k in (_step(c, budget, depth + 1) for c in (raw.get("steps") or raw.get("children") or []) if isinstance(c, dict)) if k]
    single = raw.get("attachment")
    st, sp = int(raw.get("start") or 0), int(raw.get("stop") or 0)
    params = raw.get("parameters")
    return {
        "name": str(raw.get("name") or raw.get("keyword") or raw.get("body") or ""),
        "status": str(raw.get("status") or "").lower(),
        "duration": int(raw.get("duration") or (sp - st if st and sp else 0)),
        "message": str(raw.get("message") or raw.get("statusMessage") or ""),
        "trace": str(raw.get("trace") or raw.get("statusTrace") or ""),
        "parameters": _names(params) if isinstance(params, list) else [],
        "attachments": _attachments(raw.get("attachments")) + ([a] if (a := _attachment(single)) else []),
        "steps": kids, "failed": False,
    }


def mark_failed(steps: list[dict]) -> Optional[dict]:
    """Шаг, на котором упало: первый неуспешный, а внутри него — самый глубокий неуспешный. Отмечает его и возвращает."""
    for s in steps:
        if s["status"] in _FAILED:
            inner = mark_failed(s["steps"])
            if inner:
                return inner
            s["failed"] = True
            return s
    return None


def parse_steps(data: Any) -> tuple[list[dict], list[dict]]:
    """Ответ TestOps со шагами → (дерево шагов, вложения вне шагов). Понимает список, {steps}, {children} и плоский вид."""
    budget = [MAX_STEPS]
    if isinstance(data, dict) and "scenarioSteps" in data:
        raw, top = _unflatten(data), []
    elif isinstance(data, dict):
        raw = data.get("steps") or data.get("children") or []
        top = _attachments(data.get("attachments"))
    else:
        raw, top = data if isinstance(data, list) else [], []
    return [x for x in (_step(s, budget) for s in raw if isinstance(s, dict)) if x], top


def testops_result(cfg: dict, result_id: int) -> dict:
    """Результат кейса подробно. Сам результат обязателен; шаги — первым ответившим адресом. Адрес не ответил или шагов
    нет — stepsNote говорит об этом прямо: пустой список не должен выглядеть как «шагов не было»."""
    jwt = _testops_jwt(cfg)
    base, verify = cfg["base_url"], cfg["ssl_verify"]
    url = f"{base}/api/rs/testresult/{result_id}"
    raw = _http("Allure TestOps", "GET", url, verify, token=jwt) or {}
    steps: list[dict] = []
    top: list[dict] = []
    source, note = "", ""
    for tail in _STEP_PATHS:
        try:
            data = _http("Allure TestOps", "GET", f"{url}/{tail}", verify, token=jwt)
        except HTTPException as e:
            if e.status_code == 401:
                raise
            note = str(e.detail)
            continue
        steps, top = parse_steps(data)
        source, note = tail, ""
        if steps:
            break
    if not source:
        note = f"TestOps не отдал шаги ({', '.join(_STEP_PATHS)}): {note}"
    elif not steps:
        note = "TestOps вернул результат без шагов"
    if not top:
        try:
            r = _http("Allure TestOps", "GET", f"{base}/api/rs/testresult/attachment", verify, token=jwt,
                      params={"testResultId": result_id, "page": 0, "size": 100})
            top = _attachments(r.get("content") if isinstance(r, dict) else r)
        except HTTPException as e:
            if e.status_code == 401:
                raise
    used = {a["id"] for a in _walk_attachments(steps)}
    failed = mark_failed(steps)
    tc = raw.get("testCaseId")
    return {
        "id": raw.get("id", result_id), "name": str(raw.get("name") or raw.get("fullName") or ""),
        "fullName": str(raw.get("fullName") or ""), "status": str(raw.get("status") or "unknown").lower(),
        "description": str(raw.get("description") or ""), "descriptionHtml": str(raw.get("descriptionHtml") or ""),
        "message": str(raw.get("message") or raw.get("statusMessage") or ""),
        "trace": str(raw.get("trace") or raw.get("statusTrace") or ""),
        "parameters": _names(raw.get("parameters")), "behavior": behavior_of(raw),
        "steps": steps, "failedStep": failed["name"] if failed else "", "attachments": [a for a in top if a["id"] not in used],
        "stepsSource": source, "stepsNote": note,
        "url": f"{base}/project/{cfg['project_id']}/test-cases/{tc}" if tc else "",
    }


def _walk_attachments(steps: list[dict]) -> list[dict]:
    out: list[dict] = []
    for s in steps:
        out += s["attachments"] + _walk_attachments(s["steps"])
    return out


def testops_attachment(cfg: dict, attachment_id: int) -> dict:
    """Вложение текстом (тело запроса и ответа, лог). Картинки и прочие файлы — только ссылкой из TestOps."""
    resp = _http("Allure TestOps", "GET", f"{cfg['base_url']}/api/rs/testresult/attachment/{attachment_id}/content", cfg["ssl_verify"],
                 token=_testops_jwt(cfg), raw=True, accept="*/*")
    ctype = str(resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if not any(t in ctype for t in _TEXT_TYPES):
        return {"contentType": ctype, "binary": True, "text": "", "truncated": False}
    text = resp.text
    return {"contentType": ctype, "binary": False, "text": text[:MAX_ATTACHMENT], "truncated": len(text) > MAX_ATTACHMENT}


def testops_behaviors(cfg: dict, ids: list[int]) -> dict:
    """Эпик, фича и стори результатов, поштучно и параллельно: в списке запуска TestOps их может не быть."""
    from concurrent.futures import ThreadPoolExecutor
    jwt = _testops_jwt(cfg)
    base, verify = cfg["base_url"], cfg["ssl_verify"]
    picked = ids[:MAX_BEHAVIOR_FETCH]

    def one(i: int) -> tuple[int, dict]:
        def load() -> dict:
            return behavior_of(_http("Allure TestOps", "GET", f"{base}/api/rs/testresult/{i}", verify, token=jwt) or {})
        try:
            return i, _cached(f"tob:{base}:{i}", False, load)
        except HTTPException as e:
            if e.status_code == 401:
                raise
            return i, {}
    with ThreadPoolExecutor(max_workers=_BEHAVIOR_WORKERS) as pool:
        return {"behaviors": {str(i): b for i, b in pool.map(one, picked)}, "partial": len(ids) > len(picked)}


# ── Роадмап ──────────────────────────────────────────────────────────────────

_ROADMAP_FIELDS = "summary,issuetype,status,assignee,priority,created,duedate,resolutiondate,statuscategorychangedate,issuelinks"
# Плановые даты — пользовательские поля Jira, id у каждого сервера свой: ищем по названию (русскому или английскому).
# Названия полей плановых дат: «Плановое начало», «Плановая дата начала», «План. начало», «Дата начала (план)»,
# «Начало (план)», «Planned start»… Точка и скобки в названии — не помеха.
_PLAN_START_RE = re.compile(r"план[\w.]*\s*(дата\s+)?(начал|старт)|(начал\w*|старт\w*)\s*[(\-–—,]?\s*план(?!\w)|"
                            r"planned\s*start|target\s*start|plan\s*start", re.I)
_PLAN_END_RE = re.compile(r"план[\w.]*\s*(дата\s+)?(окончан|заверш|конц|финиш)|(окончан\w*|заверш\w*)\s*[(\-–—,]?\s*план(?!\w)|"
                          r"planned\s*(end|finish)|target\s*end|plan\s*(end|finish)", re.I)
_PLAN_EXACT = {"start": ("плановое начало", "плановая дата начала"), "end": ("плановое окончание", "плановая дата окончания")}
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}")
_DMY_DAY = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})")


def plan_fields(fields: list[dict]) -> dict:
    """Поля плановых дат из списка полей Jira → {start: [...], end: [...]}: все подходящие по названию {id, name},
    лучшие — первыми: точное название («Плановое начало»), потом поля-даты, потом короткое название.
    Все — потому что в большой Jira одноимённых полей бывает несколько (из разных проектов и плагинов), а заполнено
    у задач проекта только одно: значение берётся из первого непустого."""
    def pick(rx: re.Pattern, exact: tuple) -> list[dict]:
        hits = [f for f in fields if f.get("id") and rx.search(str(f.get("name") or ""))]
        hits.sort(key=lambda f: (str(f.get("name") or "").strip().lower() not in exact,
                                 f.get("kind") not in ("date", "datetime"), len(str(f.get("name") or ""))))
        return [{"id": f["id"], "name": f.get("name") or f["id"]} for f in hits]
    return {"start": pick(_PLAN_START_RE, _PLAN_EXACT["start"]), "end": pick(_PLAN_END_RE, _PLAN_EXACT["end"])}


def _day(v: Any) -> str:
    return str(v or "")[:10]


def _plan_day(v: Any) -> str:
    """Значение поля плановой даты → «ГГГГ-ММ-ДД»: дата и дата со временем Jira, «ДД.ММ.ГГГГ» из текстового поля;
    остальное — пусто (не дата)."""
    s = str(v or "").strip() if isinstance(v, (str, int, float)) else ""
    if _ISO_DAY.match(s):
        return s[:10]
    m = _DMY_DAY.match(s)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else ""


def _plan_value(f: dict, cands: list[dict], used: Optional[dict]) -> str:
    """Первое непустое из полей-кандидатов; used — счётчик, из какого поля сколько задач взяли дату."""
    for c in cands:
        d = _plan_day(f.get(c["id"]))
        if d:
            if used is not None:
                used[c["id"]] = used.get(c["id"], 0) + 1
            return d
    return ""


def _item(raw: dict, base_url: str, epic: str, plan: Optional[dict] = None, used: Optional[dict] = None) -> dict:
    f = raw.get("fields") or {}
    status = f.get("status") or {}
    itype = str((f.get("issuetype") or {}).get("name", ""))
    cat = str((status.get("statusCategory") or {}).get("key") or "")
    plan = plan or {}
    resolved = _day(f.get("resolutiondate"))
    return {
        "key": raw.get("key", ""), "url": f"{base_url}/browse/{raw.get('key', '')}", "epic": epic,
        "type": itype, "defect": itype.strip().lower() in _DEFECT_TYPES,
        "summary": str(f.get("summary") or ""), "status": str(status.get("name") or ""),
        # new / indeterminate / done — от неё цвет полосы и «просрочено»
        "statusCategory": cat,
        "assignee": str((f.get("assignee") or {}).get("displayName") or ""),
        "priority": str((f.get("priority") or {}).get("name") or ""),
        "created": _day(f.get("created")), "due": _day(f.get("duedate")), "resolved": resolved,
        "planStart": _plan_value(f, plan.get("start") or [], used and used["start"]),
        "planEnd": _plan_value(f, plan.get("end") or [], used and used["end"]),
        # Фактическое закрытие: дата решения, а если резолюцию не ставят — когда статус перешёл в «готово».
        "closed": (resolved or _day(f.get("statuscategorychangedate"))) if cat == "done" else "",
    }


def roadmap(db: Session, epics: list[str]) -> dict:
    from backend.api import jira_tool as JT
    cfg = jira_defects._load_cfg(db)
    if not epics:
        return {"epics": [], "planFields": {"start": None, "end": None}}
    cat = JT.catalog(db=db)
    plan = plan_fields(cat.get("fields") or [])
    extra = "".join(f",{c['id']}" for cands in plan.values() for c in cands)
    used: dict[str, dict[str, int]] = {"start": {}, "end": {}}
    fields = _ROADMAP_FIELDS + extra
    found, _ = JT._search(cfg, f"key in ({', '.join(epics)})", limit=len(epics), fields=fields)
    by_key = {e["key"]: e for e in found}
    epic_link = cat.get("epic_link", JT._DEFAULT_EPIC_LINK)
    cf = epic_link.replace("customfield_", "")
    children, _ = JT._search(cfg, f"cf[{cf}] in ({', '.join(by_key)}) ORDER BY created ASC", fields=f"{fields},{epic_link}") \
        if by_key else ([], 0)
    items: dict[str, dict] = {}
    for c in children:
        epic = str((c.get("fields") or {}).get(epic_link) or "")
        items[c["key"]] = _item(c, cfg["base_url"], epic, plan, used)
    # Связанные с эпиком напрямую (обычно дефекты): из issuelinks эпика.
    linked: dict[str, str] = {}
    for k, e in by_key.items():
        for other in JT.linked_keys((e.get("fields") or {}).get("issuelinks")) or []:
            if other not in items and other not in by_key:
                linked.setdefault(other, k)
    if linked:
        for raw in JT._by_keys(cfg, list(linked)):
            items[raw["key"]] = _item(raw, cfg["base_url"], linked.get(raw["key"], ""), plan, used)
    out = []
    for k in epics:                                   # порядок — как в настройках
        if k not in by_key:
            out.append({"key": k, "missing": True, "summary": "", "issues": []})
            continue
        e = _item(by_key[k], cfg["base_url"], k, plan)
        out.append({**e, "issues": sorted((i for i in items.values() if i["epic"] == k),
                                          key=lambda i: (i["planStart"] or i["created"], i["key"]))})
    return {"epics": out, "planFields": _plan_report(plan, used, len(items))}


def _plan_report(plan: dict, used: dict, total: int) -> dict:
    """Что показать о плановых полях: start / end — поле, из которого взято больше всего дат (нет таких — лучшее
    по названию; не нашлось — None), candidates — все подошедшие по названию, filled — у скольких задач из total
    дата нашлась."""
    out: dict[str, Any] = {"candidates": plan, "filled": {}, "total": total}
    for k in ("start", "end"):
        cands = plan.get(k) or []
        best = max(cands, key=lambda c: used[k].get(c["id"], 0), default=None)
        out[k] = (best if best and used[k].get(best["id"]) else cands[0]) if cands else None
        out["filled"][k] = sum(used[k].values())
    return out


# ── Запуск автотестов (Jenkins) ──────────────────────────────────────────────

RECENT_BUILDS = 8
_JK_PARAM = "_class,name,type,description,choices,defaultParameterValue[value],allValueItems[values[name,value]]"
_JK_TREE = (f"_class,name,displayName,url,buildable,jobs[name],property[parameterDefinitions[{_JK_PARAM}]],"
            f"actions[parameterDefinitions[{_JK_PARAM}]],"
            f"builds[number,url,result,building,timestamp,duration,displayName]{{0,{RECENT_BUILDS}}}")
# Типы параметров Jenkins → вид поля формы. Остальные (плагины) — строка, а есть варианты — список.
_JK_KINDS = {"BooleanParameterDefinition": "boolean", "TextParameterDefinition": "multiline",
             "PasswordParameterDefinition": "password", "FileParameterDefinition": "file"}


def _jk_get(cfg: dict, path: str, tree: str) -> dict:
    return _http("Jenkins", "GET", f"{cfg['base_url']}{path}/api/json", cfg["ssl_verify"], auth=(cfg["user"], cfg["token"]),
                 params={"tree": tree})


def jk_param(raw: dict) -> dict:
    """Параметр джоба → поле формы. Значение пароля по умолчанию наружу не отдаём: Jenkins подставит его сам."""
    kind = _JK_KINDS.get(str(raw.get("type") or ""), "string")
    default = (raw.get("defaultParameterValue") or {}).get("value")
    choices = [str(c) for c in raw.get("choices") or []] or \
              [str(v.get("value") or v.get("name")) for v in (raw.get("allValueItems") or {}).get("values") or []]
    if choices and kind == "string":
        kind = "choice"
    if kind == "boolean":
        value: Any = bool(default)
    else:
        value = "" if kind in ("password", "file") or default is None else str(default)
    if kind == "choice" and value not in choices:
        value = choices[0]                   # у списка значение всегда из списка: первое — умолчание самого Jenkins
    return {"name": str(raw.get("name") or ""), "kind": kind, "description": str(raw.get("description") or ""),
            "default": value, "choices": choices}


def jk_params(data: dict) -> list[dict]:
    """Параметры из описания джоба. Одни версии Jenkins кладут их в property, другие — в actions."""
    seen: dict[str, dict] = {}
    for block in (data.get("property") or []) + (data.get("actions") or []):
        for raw in (block or {}).get("parameterDefinitions") or []:
            if raw.get("name"):
                seen.setdefault(str(raw["name"]), jk_param(raw))
    return list(seen.values())


def _jk_build(b: dict) -> dict:
    return {"number": b.get("number"), "url": str(b.get("url") or ""), "title": str(b.get("displayName") or ""),
            "result": "RUNNING" if b.get("building") else str(b.get("result") or ""),
            "started": _iso(b.get("timestamp")), "duration": int(b.get("duration") or 0)}


def jenkins_job(cfg: dict) -> dict:
    d = _jk_get(cfg, cfg["job_path"], _JK_TREE)
    if d.get("jobs") and not d.get("builds"):         # папка или multibranch: запускать нечего
        names = ", ".join(str(j.get("name")) for j in d["jobs"][:10])
        raise HTTPException(422, f"Ссылка ведёт на папку, а не на джоб. Внутри: {names}. Укажите ссылку на нужный джоб в настройках вкладки")
    return {"name": str(d.get("displayName") or d.get("name") or cfg["job"]), "url": str(d.get("url") or cfg["url"]),
            "buildable": d.get("buildable") is not False, "params": jk_params(d),
            "builds": [_jk_build(b) for b in d.get("builds") or []]}


_QUEUE_RE = re.compile(r"/queue/item/(\d+)")


def jenkins_run(cfg: dict, values: dict[str, Any]) -> dict:
    """Запуск джоба. Описание читаем заново: уходят только параметры, которые есть в джобе сейчас, и форма, открытая
    до правки Jenkinsfile, не отправит устаревшее. У джоба без параметров другой адрес: /build."""
    params = {p["name"]: p for p in jk_params(_jk_get(cfg, cfg["job_path"], _JK_TREE))}
    unknown = [k for k in values if k not in params]
    if unknown:
        raise HTTPException(422, f"В джобе больше нет параметров: {', '.join(unknown)}. Откройте окно запуска заново")
    data: dict[str, str] = {}
    for name, v in values.items():
        kind = params[name]["kind"]
        if kind == "file" or (kind == "password" and not v):
            continue                                   # файл из формы не передать; пустой пароль — умолчание Jenkins
        data[name] = ("true" if v else "false") if kind == "boolean" else str(v)
    path = "buildWithParameters" if params else "build"
    resp = _http("Jenkins", "POST", f"{cfg['base_url']}{cfg['job_path']}/{path}", cfg["ssl_verify"],
                 auth=(cfg["user"], cfg["token"]), data=data, raw=True)
    m = _QUEUE_RE.search(resp.headers.get("Location") or "")
    return {"status": "queued", "queueId": int(m.group(1)) if m else None}


def jenkins_queue(cfg: dict, queue_id: int) -> dict:
    """Запуск в очереди: queued (why — чего ждёт), started (сборка), cancelled. Jenkins забывает запись через пять минут
    после старта — тогда gone: сборку видно в списке последних."""
    try:
        q = _jk_get(cfg, f"/queue/item/{queue_id}", "cancelled,why,executable[number,url]")
    except HTTPException as e:
        if e.status_code == 404:
            return {"state": "gone"}
        raise
    if q.get("cancelled"):
        return {"state": "cancelled"}
    ex = q.get("executable") or {}
    if ex.get("number"):
        return {"state": "started", "number": ex["number"], "url": str(ex.get("url") or "")}
    return {"state": "queued", "why": str(q.get("why") or "")}


# ── Управление задачами эпика ────────────────────────────────────────────────

# Типы полей, в которые умеем писать дату. Поле другого типа (выпадающий список и т.п.) с похожим названием не трогаем.
_PLAN_TYPES = ("date", "datetime", "string")
_PLAN_LABEL = {"start": "Плановое начало", "end": "Плановое окончание"}


def plan_target(cands: list[dict], meta: dict, current: Optional[dict] = None) -> Optional[dict]:
    """В какое поле писать плановую дату: одноимённых полей бывает несколько, поэтому сначала то, где у задачи дата
    уже стоит, иначе первое подошедшее с экрана редактирования (editmeta). Нет на экране — None."""
    usable = [c for c in cands if ((meta.get(c["id"]) or {}).get("schema") or {}).get("type") in _PLAN_TYPES]
    return next((c for c in usable if _plan_day((current or {}).get(c["id"]))), usable[0] if usable else None)


def plan_payload(schema: dict, day: str) -> Optional[str]:
    """Дата ГГГГ-ММ-ДД → значение поля Jira по его типу; пустая дата — очистить поле.
    Для даты со временем — полдень UTC: в любом часовом поясе команды день остаётся тем же."""
    if not day:
        return None
    t = schema.get("type")
    if t == "date":
        return day
    if t == "datetime":
        return f"{day}T12:00:00.000+0000"
    return f"{day[8:10]}.{day[5:7]}.{day[:4]}"     # текстовое поле: «ДД.ММ.ГГГГ» понимает и _plan_day


def _edit_meta(cfg: dict, key: str) -> dict:
    """Поля с экрана редактирования задачи. Нет прав или сбой — пусто: задачу всё равно показываем, поля будут закрыты."""
    try:
        return (jira_defects._jira_request(cfg, "GET", f"/rest/api/2/issue/{key}/editmeta") or {}).get("fields") or {}
    except HTTPException as e:
        if e.status_code == 401:
            raise
        logger.warning("Трекинг AQA: editmeta %s недоступен: %s", key, e.detail)
        return {}


def _plan_context(db: Session, cfg: dict) -> dict:
    from backend.api import jira_tool as JT
    return plan_fields(JT.catalog(db=db).get("fields") or [])


def _raw_issue(cfg: dict, key: str, plan: dict, extra: str = "") -> dict:
    fields = _ROADMAP_FIELDS + extra + "".join(f",{c['id']}" for cands in plan.values() for c in cands)
    return jira_defects._jira_request(cfg, "GET", f"/rest/api/2/issue/{key}", params={"fields": fields}) or {}


def issue_details(db: Session, key: str) -> dict:
    """Задача для окна правки. description — вики-разметка Jira как есть: правим и пишем её же, без преобразований."""
    cfg = jira_defects._load_cfg(db)
    plan = _plan_context(db, cfg)
    raw = _raw_issue(cfg, key, plan, ",description")
    meta = _edit_meta(cfg, key)
    f = raw.get("fields") or {}

    def target(k: str) -> Optional[str]:
        c = plan_target(plan.get(k) or [], meta, f)
        return c["name"] if c else None

    prio = meta.get("priority") or {}
    return {
        **_item(raw, cfg["base_url"], "", plan),
        "description": str(f.get("description") or ""),
        "assigneeLogin": str((f.get("assignee") or {}).get("name") or ""),
        "priorityId": str((f.get("priority") or {}).get("id") or ""),
        "priorities": [{"id": str(p.get("id", "")), "name": str(p.get("name", ""))}
                       for p in prio.get("allowedValues") or [] if p.get("id")],
        # Что можно менять. Плановые даты — название поля Jira, куда уйдёт запись; None — поля нет на экране.
        "editable": {"summary": "summary" in meta, "description": "description" in meta, "priority": "priority" in meta,
                     "planStart": target("start"), "planEnd": target("end")},
    }


class IssueChange(BaseModel):
    """Что поменять в задаче. None — не трогать, пустая строка — очистить (плановую дату, исполнителя)."""
    summary: Optional[str] = Field(None, max_length=250)
    description: Optional[str] = Field(None, max_length=32000)
    priority: Optional[str] = Field(None, max_length=50)    # id приоритета из editmeta
    assignee: Optional[str] = Field(None, max_length=200)   # логин Jira
    planStart: Optional[str] = None
    planEnd: Optional[str] = None


def _valid_day(v: Optional[str], label: str) -> None:
    if not v:
        return
    try:
        datetime.strptime(v, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(422, f"{label}: нужна дата в формате ГГГГ-ММ-ДД")


def update_issue(db: Session, key: str, c: IssueChange) -> dict:
    """Изменения → Jira. Поля уходят одним запросом: Jira отвергла — не записано ничего. Исполнитель — отдельным запросом
    /assignee: он работает, даже если поля нет на экране редактирования; его сбой — предупреждение, поля уже записаны.
    Плановой даты некуда записать (поля нет на экране) — тоже предупреждение, а не молчание."""
    if c.summary is not None and not c.summary.strip():
        raise HTTPException(422, "Название не может быть пустым")
    _valid_day(c.planStart, _PLAN_LABEL["start"])
    _valid_day(c.planEnd, _PLAN_LABEL["end"])
    cfg = jira_defects._load_cfg(db)
    fields: dict[str, Any] = {}
    warnings: list[str] = []
    if c.summary is not None:
        fields["summary"] = c.summary.strip()
    if c.description is not None:
        fields["description"] = c.description
    if c.priority:
        fields["priority"] = {"id": c.priority}
    if c.planStart is not None or c.planEnd is not None:
        plan = _plan_context(db, cfg)
        cur = (_raw_issue(cfg, key, plan).get("fields") or {})
        meta = _edit_meta(cfg, key)
        start = c.planStart if c.planStart is not None else _plan_value(cur, plan.get("start") or [], None)
        end = c.planEnd if c.planEnd is not None else _plan_value(cur, plan.get("end") or [], None)
        if start and end and start > end:
            raise HTTPException(422, "Плановое начало позже планового окончания")
        for k, day in (("start", c.planStart), ("end", c.planEnd)):
            if day is None:
                continue
            target = plan_target(plan.get(k) or [], meta, cur)
            if target:
                fields[target["id"]] = plan_payload(meta[target["id"]].get("schema") or {}, day)
            else:
                warnings.append(f"«{_PLAN_LABEL[k]}» не записано: поля нет на экране редактирования задачи в Jira")
    if fields:
        jira_defects._jira_request(cfg, "PUT", f"/rest/api/2/issue/{key}", json_body={"fields": fields})
    if c.assignee is not None:
        try:
            jira_defects._jira_request(cfg, "PUT", f"/rest/api/2/issue/{key}/assignee",
                                       json_body={"name": c.assignee.strip() or None})
        except HTTPException as e:
            if e.status_code == 401:
                raise
            warnings.append(f"Исполнитель не назначен: {e.detail}")
    return {"status": "ok", "warnings": warnings}


# ── API ──────────────────────────────────────────────────────────────────────

def _settings_view(db: Session) -> dict:
    bb, to, jk = bb_cfg(db), to_cfg(db), jk_cfg(db)
    return {"bitbucketUrl": bb["url"], "bitbucketOk": bool(bb["base_url"]), "bitbucketToken": _MASK if bb["token"] else "",
            "testopsUrl": to["url"], "testopsOk": bool(to["base_url"]), "testopsToken": _MASK if to["token"] else "",
            "jenkinsUrl": jk["url"], "jenkinsOk": bool(jk["base_url"]), "jenkinsUser": jk["user"],
            "jenkinsToken": _MASK if jk["token"] else "", "epics": _epics(db), "pinnedEpics": PINNED_EPICS,
            "defaults": {"bitbucketUrl": DEFAULT_BB_URL, "testopsUrl": DEFAULT_TO_URL, "jenkinsUrl": DEFAULT_JK_URL}}


@router.get("/api/aqa/settings")
def get_settings(db: Session = Depends(get_db)) -> dict:
    return _settings_view(db)


class SettingsBody(BaseModel):
    bitbucketUrl: str = ""
    bitbucketToken: str = ""          # маска — оставить прежний, пусто — убрать
    testopsUrl: str = ""
    testopsToken: str = ""
    # None — не менять: настройки сохраняются и с графика роадмапа, там важны только эпики.
    jenkinsUrl: Optional[str] = None
    jenkinsUser: Optional[str] = None
    jenkinsToken: Optional[str] = None
    epics: list[str] = Field(default_factory=list)


_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")


@router.put("/api/aqa/settings")
def put_settings(body: SettingsBody, db: Session = Depends(get_db)) -> dict:
    if body.bitbucketUrl.strip() and not parse_bitbucket(body.bitbucketUrl):
        raise HTTPException(422, "Ссылка на Bitbucket не похожа на репозиторий: нужна вида …/projects/ПРОЕКТ/repos/РЕПОЗИТОРИЙ/…")
    if body.testopsUrl.strip() and not parse_testops(body.testopsUrl):
        raise HTTPException(422, "Ссылка на Allure TestOps не похожа на проект: нужна вида …/project/2414/…")
    if (body.jenkinsUrl or "").strip() and not parse_jenkins(body.jenkinsUrl or ""):
        raise HTTPException(422, "Ссылка на Jenkins не похожа на джоб: нужна вида …/job/ПАПКА/job/ДЖОБ/")
    epics = list(dict.fromkeys(re.sub(r"^.*/browse/", "", e.strip()).upper() for e in body.epics if e.strip()))
    bad = [e for e in epics if not _KEY_RE.match(e)]
    if bad:
        raise HTTPException(422, f"Не номер задачи Jira: {', '.join(bad)}")
    epics = [e for e in epics if e not in PINNED_EPICS]    # закреплённые всегда на месте, в настройках хранятся только свои
    if len(epics) > MAX_EPICS:
        raise HTTPException(422, f"Своих эпиков не больше {MAX_EPICS}")
    _set(db, K_BB_URL, body.bitbucketUrl.strip(), "Трекинг AQA: репозиторий Bitbucket")
    _set(db, K_TO_URL, body.testopsUrl.strip(), "Трекинг AQA: проект Allure TestOps")
    _set(db, K_EPICS, json.dumps(epics, ensure_ascii=False), "Трекинг AQA: эпики роадмапа")
    if body.jenkinsUrl is not None:
        _set(db, K_JK_URL, body.jenkinsUrl.strip(), "Трекинг AQA: джоб автотестов в Jenkins")
    if body.jenkinsUser is not None:
        _set(db, K_JK_USER, body.jenkinsUser.strip(), "Трекинг AQA: логин Jenkins")
    if body.jenkinsToken is not None and body.jenkinsToken != _MASK:
        _set(db, K_JK_TOKEN, body.jenkinsToken.strip(), "Jenkins API token (секрет)")
    for key, value, desc in ((K_BB_TOKEN, body.bitbucketToken, "Bitbucket HTTP access token (секрет)"),
                             (K_TO_TOKEN, body.testopsToken, "Allure TestOps API token (секрет)")):
        if value != _MASK:
            _set(db, key, value.strip(), desc)
    db.commit()
    _cache.clear()
    return _settings_view(db)


@router.post("/api/aqa/bitbucket/token-from-login")
def bitbucket_token_from_login(body: TokenFromLoginBody, db: Session = Depends(get_db)) -> dict:
    r = token_from_login(body, db)
    _cache.clear()
    return r


def _bb_ready(db: Session) -> dict:
    cfg = bb_cfg(db)
    if not cfg["base_url"]:
        raise HTTPException(400, "Bitbucket не подключён — укажите ссылку на репозиторий в настройках вкладки")
    if not cfg["token"]:
        raise HTTPException(400, "Нет маркера Bitbucket — войдите в Loom логином Jira или получите маркер в настройках вкладки")
    return cfg


def _to_ready(db: Session) -> dict:
    cfg = to_cfg(db)
    if not cfg["base_url"]:
        raise HTTPException(400, "Allure TestOps не подключён — укажите ссылку на проект в настройках вкладки")
    if not cfg["token"]:
        raise HTTPException(400, "Нет API-токена TestOps — создайте его в профиле TestOps (API tokens) и вставьте в настройках вкладки")
    return cfg


def _jk_ready(db: Session) -> dict:
    cfg = jk_cfg(db)
    if not cfg["base_url"]:
        raise HTTPException(400, "Jenkins не подключён — укажите ссылку на джоб в настройках вкладки")
    if not cfg["user"] or not cfg["token"]:
        raise HTTPException(400, "Нет доступа к Jenkins — укажите логин и API-токен в настройках вкладки")
    return cfg


class JenkinsRunBody(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)


@router.get("/api/aqa/jenkins/job")
def jenkins_job_route(db: Session = Depends(get_db)) -> dict:
    return jenkins_job(_jk_ready(db))


@router.post("/api/aqa/jenkins/run")
def jenkins_run_route(body: JenkinsRunBody, db: Session = Depends(get_db)) -> dict:
    return jenkins_run(_jk_ready(db), body.params)


@router.get("/api/aqa/jenkins/queue/{queue_id}")
def jenkins_queue_route(queue_id: int, db: Session = Depends(get_db)) -> dict:
    return jenkins_queue(_jk_ready(db), queue_id)


@router.get("/api/aqa/branches")
def branches(filter: str = "", refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    cfg = _bb_ready(db)
    return _cached(f"bbb:{cfg['url']}:{filter.strip().lower()}", refresh, lambda: bb_branches(cfg, filter))


@router.get("/api/aqa/commits")
def commits(branch: str = "", refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    cfg = _bb_ready(db)
    return {**_cached(f"bb:{cfg['url']}:{branch.strip()}", refresh, lambda: bb_commits(cfg, branch)),
            "loadedAt": datetime.now().isoformat(timespec="seconds")}


@router.get("/api/aqa/testops")
def testops(refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    cfg = _to_ready(db)
    return {**_cached(f"to:{cfg['url']}", refresh, lambda: testops_launches(cfg)), "loadedAt": datetime.now().isoformat(timespec="seconds")}


@router.get("/api/aqa/testops/launch/{launch_id}")
def testops_launch_route(launch_id: int, refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    cfg = _to_ready(db)
    return {**_cached(f"tol:{cfg['url']}:{launch_id}", refresh, lambda: testops_launch(cfg, launch_id)),
            "loadedAt": datetime.now().isoformat(timespec="seconds")}


@router.get("/api/aqa/testops/result/{result_id}")
def testops_result_route(result_id: int, db: Session = Depends(get_db)) -> dict:
    return testops_result(_to_ready(db), result_id)


@router.get("/api/aqa/testops/attachment/{attachment_id}")
def testops_attachment_route(attachment_id: int, db: Session = Depends(get_db)) -> dict:
    return testops_attachment(_to_ready(db), attachment_id)


class BehaviorsBody(BaseModel):
    ids: list[int] = Field(default_factory=list)


@router.post("/api/aqa/testops/behaviors")
def testops_behaviors_route(body: BehaviorsBody, db: Session = Depends(get_db)) -> dict:
    return testops_behaviors(_to_ready(db), body.ids)


@router.get("/api/aqa/commit/{commit_id}")
def commit_route(commit_id: str, db: Session = Depends(get_db)) -> dict:
    if not re.fullmatch(r"[0-9a-fA-F]{7,40}", commit_id):
        raise HTTPException(422, "Не хеш коммита")
    cfg = _bb_ready(db)
    # Коммит не меняется — кэш без refresh.
    return _cached(f"bbc:{cfg['url']}:{commit_id.lower()}", False, lambda: bb_commit(cfg, commit_id))


@router.get("/api/aqa/commit/{commit_id}/diff")
def commit_file_diff_route(commit_id: str, path: str, src: str = "", db: Session = Depends(get_db)) -> dict:
    if not re.fullmatch(r"[0-9a-fA-F]{7,40}", commit_id):
        raise HTTPException(422, "Не хеш коммита")
    if not path.strip() or ".." in path.split("/"):
        raise HTTPException(422, "Путь к файлу не указан")
    cfg = _bb_ready(db)
    return _cached(f"bbd:{cfg['url']}:{commit_id.lower()}:{path}:{src}", False, lambda: bb_file_diff(cfg, commit_id, path, src))


def _issue_key(key: str) -> str:
    k = key.strip().upper()
    if not _KEY_RE.match(k):
        raise HTTPException(422, f"Некорректный номер задачи: {key}")
    return k


@router.get("/api/aqa/issue/{key}")
def issue_route(key: str, db: Session = Depends(get_db)) -> dict:
    return issue_details(db, _issue_key(key))


@router.put("/api/aqa/issue/{key}")
def issue_update_route(key: str, body: IssueChange, db: Session = Depends(get_db)) -> dict:
    return update_issue(db, _issue_key(key), body)


def save_snapshot(epics: list[str], data: dict) -> None:
    """Роадмап → data/aqa_roadmap.json (через временный файл: оборванная запись не портит прежний снимок)."""
    try:
        SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = SNAPSHOT_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"savedAt": datetime.now().isoformat(timespec="seconds"), "keys": epics, **data},
                                  ensure_ascii=False), "utf-8")
        tmp.replace(SNAPSHOT_FILE)
    except OSError as e:
        logger.warning("Трекинг AQA: снимок роадмапа не сохранён: %s", e)


def load_snapshot() -> Optional[dict]:
    try:
        v = json.loads(SNAPSHOT_FILE.read_text("utf-8"))
        return v if isinstance(v, dict) else None
    except (OSError, ValueError):
        return None


@router.get("/api/aqa/roadmap")
def roadmap_route(refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    """Роадмап из Jira; каждый удачный ответ — в снимок. Jira недоступна, а снимок по тем же эпикам есть (в том числе
    восстановленный из резервной копии) — отдаём его с пометкой snapshot: когда сохранён и почему не из Jira."""
    epics = _epics(db)
    try:
        data = _cached(f"rm:{','.join(epics)}", refresh, lambda: roadmap(db, epics))
    except HTTPException as e:
        snap = load_snapshot()
        if not epics or not snap or snap.get("keys") != epics:
            raise
        rest = {k: v for k, v in snap.items() if k not in ("savedAt", "keys")}
        return {**rest, "loadedAt": snap.get("savedAt", ""), "snapshot": {"savedAt": snap.get("savedAt", ""), "reason": str(e.detail)}}
    if epics:
        save_snapshot(epics, data)
    return {**data, "loadedAt": datetime.now().isoformat(timespec="seconds")}
