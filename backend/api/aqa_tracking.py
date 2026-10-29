"""
Трекинг AQA — развитие автотестов одной вкладкой.

  • Bitbucket (stash): коммиты репозитория автотестов — за сегодня, за 7 дней (с сегодняшним), всего и последний.
    Считаются коммиты ветки по умолчанию, как их показывает Bitbucket (с merge-коммитами).
  • Allure TestOps: запуски проекта — сколько сегодня, последний (дата, кейсы по статусам), кейсы всех запусков за сегодня.
  • Роадмап: эпики AQA (ключи в настройках) с задачами и дефектами — их стори/задачи/дефекты по Epic Link и задачи,
    связанные с эпиком. Даты для таймлайна: начало — создание, конец — срок (duedate), без срока — дата решения,
    не решена — сегодня.

Источники задаются ссылками, как их копируют из браузера:
  https://stash.sigma.sbrf.ru/projects/SBER911/repos/sber911-aqa/browse
  https://testops.sigma.sbrf.ru/project/2414/test-cases
Маркер Bitbucket выпускается при входе логином Jira (corp_auth) или кнопкой в настройках — по логину/паролю Сигмы;
API-токен TestOps вставляется в настройках (по паролю TestOps токены не выдаёт). Секреты — в metrics_settings, как
маркеры Jira, наружу — маской.

  GET  /api/aqa/settings                     — ссылки, эпики, есть ли маркеры
  PUT  /api/aqa/settings                     — сохранить (маска вместо маркера — оставить прежний)
  POST /api/aqa/bitbucket/token-from-login   — маркер Bitbucket по логину/паролю
  GET  /api/aqa/commits?refresh=             — коммиты
  GET  /api/aqa/testops?refresh=             — запуски
  GET  /api/aqa/roadmap?refresh=             — эпики с задачами
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any, Optional

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
K_EPICS = "aqa_epics"
MAX_EPICS = 5
CACHE_TTL = 300                        # 5 минут: вкладку открывают часто, а полный счёт коммитов — сотни запросов
TODAY_STATS_LIMIT = 30                 # запусков за сегодня, по которым суммируются кейсы

_BB_RE = re.compile(r"^(https?://.+?)/projects/([^/]+)/repos/([^/?#]+)", re.I)
_TO_RE = re.compile(r"^(https?://.+?)/project/(\d+)", re.I)
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


def _epics(db: Session) -> list[str]:
    try:
        v = json.loads(_get(db, K_EPICS, "[]"))
        return [str(x).strip().upper() for x in v if str(x).strip()][:MAX_EPICS] if isinstance(v, list) else []
    except ValueError:
        return []


def _ssl_verify(db: Session) -> Any:
    # Корпоративные серверы за тем же прокси, что и Jira: настройку проверки сертификата берём оттуда.
    return jira_defects._load_cfg(db)["ssl_verify"]


def bb_cfg(db: Session) -> dict:
    url = _get(db, K_BB_URL)
    p = parse_bitbucket(url) or {"base_url": "", "project": "", "repo": ""}
    return {**p, "url": url, "token": _get(db, K_BB_TOKEN), "token_path": "", "ssl_verify": _ssl_verify(db)}


def to_cfg(db: Session) -> dict:
    url = _get(db, K_TO_URL)
    p = parse_testops(url) or {"base_url": "", "project_id": 0}
    return {**p, "url": url, "token": _get(db, K_TO_TOKEN), "ssl_verify": _ssl_verify(db)}


# ── HTTP ─────────────────────────────────────────────────────────────────────

def _http(name: str, method: str, url: str, verify: Any, *, token: str = "", auth: Optional[tuple] = None,
          params: Optional[dict] = None, json_body: Any = None, data: Optional[dict] = None, timeout: int = 30,
          text: bool = False) -> Any:
    """Запрос к Bitbucket или TestOps; ошибки — понятным текстом с именем системы, как у Jira."""
    import requests
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; SimpleTest-QA/1.0)"}
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
                  json_body={"name": f"SimpleTest {time.strftime('%Y-%m-%d %H:%M')}",
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


def bb_commits(cfg: dict) -> dict:
    """Коммиты ветки по умолчанию: сегодня, 7 дней, всего, последний. Всего — по всем страницам (до 1000 на страницу)."""
    url = f"{cfg['base_url']}/rest/api/1.0/projects/{cfg['project']}/repos/{cfg['repo']}/commits"
    today0, week0 = _ms(_day_start()), _ms(_day_start(6))
    total = today = week = 0
    last: Optional[dict] = None
    start, pages, truncated = 0, 0, False
    while True:
        data = _http("Bitbucket", "GET", url, cfg["ssl_verify"], token=cfg["token"], params={"limit": 1000, "start": start})
        for c in data.get("values") or []:
            ts = int(c.get("committerTimestamp") or c.get("authorTimestamp") or 0)
            total += 1
            today += ts >= today0
            week += ts >= week0
            if last is None:
                author = c.get("author") or {}
                last = {"id": c.get("displayId") or str(c.get("id", ""))[:11], "message": str(c.get("message", "")).split("\n")[0][:200],
                        "author": author.get("displayName") or author.get("name") or "", "date": _iso(ts),
                        "url": f"{cfg['base_url']}/projects/{cfg['project']}/repos/{cfg['repo']}/commits/{c.get('id', '')}"}
        pages += 1
        if data.get("isLastPage", True) or data.get("nextPageStart") is None:
            break
        if pages >= 100:                            # 100 000 коммитов — дальше «всего» не точное
            truncated = True
            break
        start = int(data["nextPageStart"])
    return {"today": today, "week": week, "total": total, "totalTruncated": truncated, "last": last,
            "repoUrl": f"{cfg['base_url']}/projects/{cfg['project']}/repos/{cfg['repo']}/browse"}


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

    def stat(launch_id: Any) -> dict[str, int]:
        return _stats(_http("Allure TestOps", "GET", f"{base}/api/rs/launch/{launch_id}/statistic", verify, token=jwt))

    today_stats: dict[str, int] = {}
    for x in todays[:TODAY_STATS_LIMIT]:
        for k, v in stat(x["id"]).items():
            today_stats[k] = today_stats.get(k, 0) + v
    last = None
    if launches:
        x = launches[0]
        last = {"id": x.get("id"), "name": x.get("name", ""), "date": _iso(_created(x)), "closed": bool(x.get("closed")),
                "url": f"{base}/launch/{x.get('id')}", "stats": stat(x["id"])}
    return {"todayLaunches": len(todays), "todayStats": today_stats,
            "todayStatsPartial": len(todays) > TODAY_STATS_LIMIT, "last": last,
            "projectUrl": f"{base}/project/{cfg['project_id']}/launches"}


# ── Роадмап ──────────────────────────────────────────────────────────────────

_ROADMAP_FIELDS = "summary,issuetype,status,assignee,priority,created,duedate,resolutiondate,issuelinks"


def _item(raw: dict, base_url: str, epic: str) -> dict:
    f = raw.get("fields") or {}
    status = f.get("status") or {}
    itype = str((f.get("issuetype") or {}).get("name", ""))
    return {
        "key": raw.get("key", ""), "url": f"{base_url}/browse/{raw.get('key', '')}", "epic": epic,
        "type": itype, "defect": itype.strip().lower() in _DEFECT_TYPES,
        "summary": str(f.get("summary") or ""), "status": str(status.get("name") or ""),
        # new / indeterminate / done — от неё цвет полосы и «просрочено»
        "statusCategory": str((status.get("statusCategory") or {}).get("key") or ""),
        "assignee": str((f.get("assignee") or {}).get("displayName") or ""),
        "priority": str((f.get("priority") or {}).get("name") or ""),
        "created": str(f.get("created") or "")[:10], "due": str(f.get("duedate") or "")[:10],
        "resolved": str(f.get("resolutiondate") or "")[:10],
    }


def roadmap(db: Session, epics: list[str]) -> dict:
    from backend.api import jira_tool as JT
    cfg = jira_defects._load_cfg(db)
    if not epics:
        return {"epics": []}
    found, _ = JT._search(cfg, f"key in ({', '.join(epics)})", limit=len(epics), fields=_ROADMAP_FIELDS)
    by_key = {e["key"]: e for e in found}
    epic_link = JT.catalog(db=db).get("epic_link", JT._DEFAULT_EPIC_LINK)
    cf = epic_link.replace("customfield_", "")
    children, _ = JT._search(cfg, f"cf[{cf}] in ({', '.join(by_key)}) ORDER BY created ASC", fields=f"{_ROADMAP_FIELDS},{epic_link}") \
        if by_key else ([], 0)
    items: dict[str, dict] = {}
    for c in children:
        epic = str((c.get("fields") or {}).get(epic_link) or "")
        items[c["key"]] = _item(c, cfg["base_url"], epic)
    # Связанные с эпиком напрямую (обычно дефекты): из issuelinks эпика.
    linked: dict[str, str] = {}
    for k, e in by_key.items():
        for other in JT.linked_keys((e.get("fields") or {}).get("issuelinks")) or []:
            if other not in items and other not in by_key:
                linked.setdefault(other, k)
    if linked:
        for raw in JT._by_keys(cfg, list(linked)):
            items[raw["key"]] = _item(raw, cfg["base_url"], linked.get(raw["key"], ""))
    out = []
    for k in epics:                                   # порядок — как в настройках
        if k not in by_key:
            out.append({"key": k, "missing": True, "summary": "", "issues": []})
            continue
        e = _item(by_key[k], cfg["base_url"], k)
        out.append({**e, "issues": sorted((i for i in items.values() if i["epic"] == k), key=lambda i: (i["created"], i["key"]))})
    return {"epics": out}


# ── API ──────────────────────────────────────────────────────────────────────

def _settings_view(db: Session) -> dict:
    bb, to = bb_cfg(db), to_cfg(db)
    return {"bitbucketUrl": bb["url"], "bitbucketOk": bool(bb["base_url"]), "bitbucketToken": _MASK if bb["token"] else "",
            "testopsUrl": to["url"], "testopsOk": bool(to["base_url"]), "testopsToken": _MASK if to["token"] else "",
            "epics": _epics(db)}


@router.get("/api/aqa/settings")
def get_settings(db: Session = Depends(get_db)) -> dict:
    return _settings_view(db)


class SettingsBody(BaseModel):
    bitbucketUrl: str = ""
    bitbucketToken: str = ""          # маска — оставить прежний, пусто — убрать
    testopsUrl: str = ""
    testopsToken: str = ""
    epics: list[str] = Field(default_factory=list)


_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")


@router.put("/api/aqa/settings")
def put_settings(body: SettingsBody, db: Session = Depends(get_db)) -> dict:
    if body.bitbucketUrl.strip() and not parse_bitbucket(body.bitbucketUrl):
        raise HTTPException(422, "Ссылка на Bitbucket не похожа на репозиторий: нужна вида …/projects/ПРОЕКТ/repos/РЕПОЗИТОРИЙ/…")
    if body.testopsUrl.strip() and not parse_testops(body.testopsUrl):
        raise HTTPException(422, "Ссылка на Allure TestOps не похожа на проект: нужна вида …/project/2414/…")
    epics = list(dict.fromkeys(re.sub(r"^.*/browse/", "", e.strip()).upper() for e in body.epics if e.strip()))
    bad = [e for e in epics if not _KEY_RE.match(e)]
    if bad:
        raise HTTPException(422, f"Не номер задачи Jira: {', '.join(bad)}")
    if len(epics) > MAX_EPICS:
        raise HTTPException(422, f"Эпиков не больше {MAX_EPICS}")
    _set(db, K_BB_URL, body.bitbucketUrl.strip(), "Трекинг AQA: репозиторий Bitbucket")
    _set(db, K_TO_URL, body.testopsUrl.strip(), "Трекинг AQA: проект Allure TestOps")
    _set(db, K_EPICS, json.dumps(epics, ensure_ascii=False), "Трекинг AQA: эпики роадмапа")
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


@router.get("/api/aqa/commits")
def commits(refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    cfg = bb_cfg(db)
    if not cfg["base_url"]:
        raise HTTPException(400, "Bitbucket не подключён — укажите ссылку на репозиторий в настройках вкладки")
    if not cfg["token"]:
        raise HTTPException(400, "Нет маркера Bitbucket — войдите в SimpleTest логином Jira или получите маркер в настройках вкладки")
    return {**_cached(f"bb:{cfg['url']}", refresh, lambda: bb_commits(cfg)), "loadedAt": datetime.now().isoformat(timespec="seconds")}


@router.get("/api/aqa/testops")
def testops(refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    cfg = to_cfg(db)
    if not cfg["base_url"]:
        raise HTTPException(400, "Allure TestOps не подключён — укажите ссылку на проект в настройках вкладки")
    if not cfg["token"]:
        raise HTTPException(400, "Нет API-токена TestOps — создайте его в профиле TestOps (API tokens) и вставьте в настройках вкладки")
    return {**_cached(f"to:{cfg['url']}", refresh, lambda: testops_launches(cfg)), "loadedAt": datetime.now().isoformat(timespec="seconds")}


@router.get("/api/aqa/roadmap")
def roadmap_route(refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    epics = _epics(db)
    return {**_cached(f"rm:{','.join(epics)}", refresh, lambda: roadmap(db, epics)), "loadedAt": datetime.now().isoformat(timespec="seconds")}
