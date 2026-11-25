"""Employee activity from Jira, the configured Bitbucket repository and Zephyr."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta
import re
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from backend.api import aqa_tracking as aqa, jira_tool as jira, zephyr
from db.postgres import SessionLocal

PERIOD_DAYS = {"today": 1, "week": 7, "fortnight": 14, "month": 30}
COMMIT_LIST_SIZE = 10
RUN_DETAIL_LIMIT = 5


def _identity(value):
    return str(value or "").strip().casefold()


def _quote(value):
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _zone(widget):
    return ZoneInfo(widget["activityTimezone"]) if widget["activityTimezone"] else None


def date_range(widget):
    """Inclusive start, exclusive end, expressed as calendar days."""
    if widget["activityPeriod"] == "custom":
        start = date.fromisoformat(widget["activityFrom"])
        end = date.fromisoformat(widget["activityTo"]) if widget["activityTo"] else start
        return start, end + timedelta(days=1)
    today = datetime.now(_zone(widget)).date()
    days = PERIOD_DAYS[widget["activityPeriod"]]
    return today - timedelta(days=days - 1), today + timedelta(days=1)


def employee_profile(login):
    with SessionLocal() as db:
        cfg = jira._load_cfg(db)
        return aqa._cached(f"dashboard:jira-user:{cfg['base_url']}:{_identity(login)}", False,
                           lambda: jira._jira_request(cfg, "GET", "/rest/api/2/user", params={"username": login}))


def _issue_metrics(widget, window):
    with SessionLocal() as db:
        cfg = jira._load_cfg(db)
    login = _quote(widget["employeeLogin"])
    project = f"project = {_quote(widget['activityProject'])}"
    start, stop = map(date.isoformat, window)

    def within(field):
        return f'{field} >= "{start}" AND {field} < "{stop}"'

    def metric(label, clause, detail=""):
        query = f"{project} AND {clause}"
        try:
            data = jira._jira_request(cfg, "GET", "/rest/api/2/search", params={
                "jql": query, "fields": "key", "maxResults": 1, "validateQuery": "true",
            })
            return {"label": label, "value": int(data["total"]),
                    "url": f"{cfg['base_url']}/issues/?{urlencode({'jql': query})}", "detail": detail}
        except HTTPException as exc:
            return {"label": label, "value": None, "detail": str(exc.detail)[:160], "unavailable": True}

    last = window[1] - timedelta(days=1)
    metrics = {
        "jiraCreated": ("Созданные задачи", f"creator = {login} AND {within('created')}", ""),
        "jiraUpdated": ("Обновлённые назначенные задачи", f"assignee = {login} AND {within('updated')}", "По дате последнего обновления"),
        "jiraTransitions": ("Задачи со сменой статуса", f'status CHANGED BY {login} DURING ("{start} 00:00", "{last} 23:59")', "Статус менял сотрудник"),
    }
    roles = []
    for role in widget["defectRoles"]:
        field = f"cf[{role.removeprefix('customfield_')}]" if role.startswith("customfield_") else role
        roles.append(f"{field} = {login}")
    if roles:
        metrics["jiraOpenDefects"] = (
            "Открытые дефекты", f"issuetype = {_quote(cfg['issuetype'])} AND statusCategory != Done AND ({' OR '.join(roles)})",
            "На текущий момент",
        )
    result = [metric(*metrics[key]) for key in widget["activityMetrics"] if key in metrics]
    if "jiraOpenDefects" in widget["activityMetrics"] and not roles:
        result.append({"label": "Открытые дефекты", "value": None, "detail": "Выберите роли в дефектах"})
    return {"metrics": result}


def _commits(widget, window, profile):
    with SessionLocal() as db:
        cfg = aqa._bb_ready(db)
    branch = widget["activityBranch"]
    zone = _zone(widget)
    start, stop = (int(datetime.combine(day, time.min, zone).timestamp() * 1000) for day in window)
    login = _identity(widget["employeeLogin"])
    email = _identity(profile.get("emailAddress"))
    selected = widget["activityMetrics"]

    def load():
        matches = []
        truncated = False
        for commits, truncated in aqa.bb_commit_pages(cfg, branch):
            for commit in commits:
                author = commit.get("author") or {}
                identities = {_identity(author.get(key)) for key in ("name", "slug")}
                author_email = _identity(author.get("emailAddress"))
                if login not in identities and not (email and email == author_email):
                    continue
                timestamp = int(commit.get("authorTimestamp") or commit.get("committerTimestamp") or 0)
                if start <= timestamp < stop:
                    matches.append((timestamp, commit))
        matches.sort(key=lambda entry: entry[0], reverse=True)
        items = [{**aqa._commit_view(commit, cfg, timestamp),
                  "date": datetime.fromtimestamp(timestamp / 1000, zone).isoformat(timespec="seconds")}
                 for timestamp, commit in matches[:COMMIT_LIST_SIZE]]
        repo_url = f"{cfg['base_url']}/projects/{cfg['project']}/repos/{cfg['repo']}/commits"
        if branch:
            repo_url += "?" + urlencode({"until": aqa._ref(branch)})
        return len(matches), items, truncated, repo_url

    count, items, truncated, repo_url = aqa._cached(
        f"dashboard:commits:{cfg['url']}:{branch}:{login}:{email}:{start}:{stop}", False, load)
    result = {"metrics": []}
    if "bbCommitCount" in selected:
        result["metrics"].append({"label": "Коммиты", "value": count, "url": repo_url,
                                  "detail": "Выборка ограничена" if truncated else branch or "Ветка по умолчанию"})
    if "bbCommitList" in selected:
        result["commits"] = items
        result["listDetail"] = "Выборка ограничена" if truncated else f"Показаны {len(items)} из {count}" if count > len(items) else ""
    return result


def _run_day(value, zone):
    try:
        stamp = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return stamp.astimezone(zone).date() if stamp.tzinfo else stamp.date()


def _assigned_runs(widget, window, profile):
    with SessionLocal() as db:
        cfg = zephyr._load_cfg(db)
    index = zephyr.get_index(cfg, widget["activityProject"], kind="testrun")
    identity = {_identity(widget["employeeLogin"]), _identity(profile.get("key"))} - {""}
    zone = _zone(widget)
    start, stop = window
    ordered = sorted(index["cases"].values(), key=lambda r: zephyr._key_num(r["key"]), reverse=True)
    rows, remaining, unknown = [], RUN_DETAIL_LIMIT, False
    for item in ordered:
        planned_start, planned_end = (_run_day(item.get(key), zone) for key in ("plannedStart", "plannedEnd"))
        first = planned_start or planned_end or _run_day(item.get("created"), zone)
        last = planned_end or first
        if first is None:
            unknown = True
            continue
        if first >= stop or last < start:
            continue
        assigned = item.get("assignees")
        key = item["key"]
        if assigned is None and remaining and re.fullmatch(r"[A-Z][A-Z0-9_]*-[A-Z]*\d+", key):
            remaining -= 1

            def load():
                raw = zephyr._first_working(cfg, "testrun-get", [
                    (f"{zephyr.ATM}/testrun/{key}", {}), (f"{zephyr.ATM}/testcycle/{key}", {}),
                ], timeout=8)
                return zephyr.norm_run(raw).get("assignees")

            try:
                assigned = aqa._cached(f"dashboard:zephyr:{cfg['base_url']}:{key}", False, load)
            except HTTPException:
                pass
        if assigned is None:
            unknown = True
        elif identity.intersection(map(_identity, assigned)):
            rows.append({"key": key, "name": item["name"], "url": zephyr.run_url(cfg["base_url"], key)})
    detail = "Часть назначений недоступна" if unknown else "По датам прогона"
    result = {"metrics": []}
    if "zephyrRunCount" in widget["activityMetrics"]:
        result["metrics"].append({"label": "Назначенные прогоны", "value": len(rows) if rows or not unknown else None,
                                  "detail": detail})
    if "zephyrRunList" in widget["activityMetrics"]:
        result.update(runs=rows, listDetail=detail if unknown else "")
    return result


def collect(widget, window):
    try:
        profile = employee_profile(widget["employeeLogin"])
    except HTTPException:
        profile = {}
    selected = widget["activityMetrics"]
    sources = {}
    if any(key.startswith("jira") for key in selected):
        sources["Jira"] = (_issue_metrics, (widget, window))
    if any(key.startswith("bb") for key in selected):
        sources["Bitbucket"] = (_commits, (widget, window, profile))
    if any(key.startswith("zephyr") for key in selected):
        sources["Zephyr"] = (_assigned_runs, (widget, window, profile))
    with ThreadPoolExecutor(max_workers=len(sources)) as pool:
        requests = {name: pool.submit(read, *args) for name, (read, args) in sources.items()}
        result = {}
        for name, response in requests.items():
            try:
                result[name] = response.result()
            except HTTPException as exc:
                result[name] = {"error": str(exc.detail)[:200]}
            except Exception:
                result[name] = {"error": f"{name} не ответил."}
    return result, profile.get("displayName", "")
