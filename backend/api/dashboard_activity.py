"""Employee activity from Jira, the configured Bitbucket repository and Zephyr."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta
import re
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


JIRA_DEFECT_METRICS = {
    "jiraDefectsCreated": "Создал дефектов",
    "jiraDefectsActive": "Дефекты в работе",
    "jiraDefectsProcessed": "Обработал дефектов",
}


def _processed_defects(cfg, query, widget, window, profile):
    start, stop = map(date.isoformat, window)
    login = _quote(widget["employeeLogin"])
    candidate = f'{query} AND key IN updatedBy({login}, "{start}", "{stop}")'
    try:
        issues, total = jira._search(cfg, candidate, fields="updated", expand="changelog", validate_query=True)
    except HTTPException as exc:
        if exc.status_code != 400:
            raise
        # Jira editions without updatedBy can still supply the actual change history.
        issues, total = jira._search(cfg, f'{query} AND updated >= "{start}"',
                                     fields="updated", expand="changelog", validate_query=True)
    identities = {_identity(widget["employeeLogin"]), _identity(profile.get("key")), _identity(profile.get("accountId"))} - {""}
    keys = {}
    partial = len(issues) < total
    for issue in issues:
        log = issue.get("changelog") or {}
        histories = log.get("histories")
        if not isinstance(histories, list):
            partial = True
            continue
        for history in histories:
            day = str(history.get("created") or "")[:10]
            author = history.get("author") or {}
            if (start <= day < stop and history.get("items") and
                    identities.intersection(_identity(author.get(field)) for field in ("name", "key", "accountId"))):
                keys[issue["key"]] = None
                break
        else:
            if log.get("total", 0) > len(histories):
                partial = True
    return {"value": len(keys), "issueKeys": list(keys), "partial": partial,
            "detail": "Учтена доступная часть истории" if partial else "По изменениям в истории Jira"}


def _issue_metrics(widget, window, profile):
    with SessionLocal() as db:
        cfg = jira._load_cfg(db)
        login = _quote(widget["employeeLogin"])
        query = f"project = {_quote(widget['activityProject'])} AND issuetype = {_quote(cfg['issuetype'])}"
        start, stop = map(date.isoformat, window)

        def count(jql, detail="", partial=False):
            _, total = jira._search(cfg, jql, limit=1, fields="key", validate_query=True)
            return {"value": total, "jql": jql, "detail": detail, "partial": partial}

        def active():
            fields = jira.catalog(db=db)["fields"]
            testers = [f"cf[{field['id'].split('_')[1]}]" for field in fields
                       if field["name"].strip().casefold() in ("тестировщик", "тестировщики", "tester", "testers")
                       and field["kind"] in ("user", "multi") and re.fullmatch(r"customfield_\d+", field["id"])]
            working = f"{query} AND statusCategory != Done"
            if testers:
                roles = " OR ".join(f"{field} = {login}" for field in ["assignee", *testers])
                return count(f"{working} AND ({roles})", "Исполнитель или тестировщик · сейчас")
            return count(f"{working} AND assignee = {login}", "Поле «Тестировщик» недоступно · учтены исполнители", partial=True)

        read = {
            "jiraDefectsCreated": lambda: count(f'{query} AND creator = {login} AND created >= "{start}" AND created < "{stop}"'),
            "jiraDefectsActive": active,
            "jiraDefectsProcessed": lambda: _processed_defects(cfg, query, widget, window, profile),
        }
        metrics = []
        for metric, label in JIRA_DEFECT_METRICS.items():
            if metric not in widget["activityMetrics"]:
                continue
            try:
                result = read[metric]()
            except HTTPException as exc:
                result = {"value": None, "detail": str(exc.detail)[:160], "unavailable": True}
            metrics.append({"label": label, **result})
        return {"metrics": metrics}


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
        sources["Jira"] = (_issue_metrics, (widget, window, profile))
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
