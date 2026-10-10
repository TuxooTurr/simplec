"""
MCP-сервер SimpleTest — два набора инструментов в одном процессе:

- simpletest_* — функции SimpleTest для GigaCode: требования, оформление
  баг-репорта, представления Jira-аналитики (нужен запущенный SimpleTest);
- dropup_*     — web-коннектор к консоли OpenShift (dropup) через браузер с
  сессией пользователя: проекты, сервисы, поды, логи, разбор ошибок. Это основа
  нового анализатора логов SimpleTest.

Все инструменты только читают. Создание дефекта в Jira — через MCP `jira`
после явного подтверждения пользователя (см. GIGACODE.md).
"""

from __future__ import annotations

import json
import re
from typing import Optional

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .dropup import ConsoleClient, ConsoleError
from .log_triage import render_markdown, triage
from .simpletest_api import SimpleTestClient, SimpleTestError

INSTRUCTIONS = """\
Инструменты SimpleTest и логов dropup (OpenShift) для QA-команды.

Логи сервиса: logs_analyze(service, minutes) — источник настроен в SimpleTest (веб-коннектор).
Прямой доступ к консоли OpenShift: сначала dropup_status. Если сессии нет — dropup_login (откроется окно браузера,
пользователь входит сам). Дальше dropup_projects → dropup_services → dropup_triage
(сгруппированные ошибки) или dropup_check (сводка по нескольким сервисам стенда).
Сырые строки — dropup_logs. Черновик дефекта по найденной ошибке — simpletest_format_bug;
создавать дефект в Jira только после явного подтверждения пользователя.
"""

mcp = MCPServer(name="simpletest", instructions=INSTRUCTIONS, version="1.0.0")

_console = ConsoleClient()
_simpletest = SimpleTestClient()

READ = ToolAnnotations(read_only_hint=True, open_world_hint=True)


def _fail(e: Exception) -> ToolError:
    return ToolError(str(e))


# ══ SimpleTest ═══════════════════════════════════════════════════════════════

@mcp.tool(annotations=READ)
async def simpletest_requirements(query: str = "") -> str:
    """Список требований из библиотеки SimpleTest (раздел «Данные → Требования»).

    query — фильтр по названию или фиче (без учёта регистра); пусто — все.
    """
    try:
        items = await _simpletest.request("GET", "/api/requirements")
    except SimpleTestError as e:
        raise _fail(e)
    q = query.strip().lower()
    if q:
        items = [i for i in items if q in (i.get("name", "") + " " + i.get("feature", "")).lower()]
    if not items:
        return "Требований не найдено."
    rows = [f"- `{i['id']}` — {i.get('name', '')}"
            + (f" [{i['feature']}]" if i.get("feature") else "")
            + (" · есть QA-документация" if i.get("qa_doc") else "")
            for i in items[:50]]
    return f"Требований: {len(items)}\n" + "\n".join(rows)


@mcp.tool(annotations=READ)
async def simpletest_requirement(requirement_id: str, part: str = "both") -> str:
    """Текст требования по id из simpletest_requirements.

    part: "text" — исходник, "qa_doc" — QA-документация, "both" — оба.
    """
    try:
        items = await _simpletest.request("GET", "/api/requirements")
    except SimpleTestError as e:
        raise _fail(e)
    item = next((i for i in items if i.get("id") == requirement_id), None)
    if not item:
        raise ToolError(f"Требование {requirement_id} не найдено — список: simpletest_requirements.")
    out = [f"# {item.get('name', '')}" + (f" [{item['feature']}]" if item.get("feature") else "")]
    if part in ("text", "both"):
        out += ["", "## Исходник", item.get("text", "")[:20000]]
    if part in ("qa_doc", "both") and item.get("qa_doc"):
        out += ["", "## QA-документация", item["qa_doc"][:20000]]
    return "\n".join(out)


@mcp.tool(annotations=ToolAnnotations(read_only_hint=True, open_world_hint=True))
async def simpletest_format_bug(description: str, platform: str = "Back", feature: str = "",
                                provider: str = "gigachat") -> str:
    """Оформить баг-репорт по шаблону SimpleTest (название, описание, шаги, ФР/ОР, приоритет).

    description — описание проблемы своими словами, можно с фрагментом лога.
    platform — Back / Front / Mobile и т.п.; feature — модуль или фича.
    В Jira ничего не создаёт: результат — черновик для показа пользователю.
    """
    form = [("platform", (None, platform)), ("feature", (None, feature)),
            ("description", (None, description)), ("provider", (None, provider))]
    try:
        res = await _simpletest.request("POST", "/api/bugs/format", files=form)
    except SimpleTestError as e:
        raise _fail(e)
    return res.get("report", "") + (f"\n\n(Приоритет для Jira: {res['priority']})" if res.get("priority") else "")


@mcp.tool(annotations=READ)
async def simpletest_jira_views() -> str:
    """Сохранённые представления Jira-аналитики SimpleTest (выборка + группировка + колонки)."""
    try:
        res = await _simpletest.request("GET", "/api/jira/views")
    except SimpleTestError as e:
        raise _fail(e)
    views = res.get("views", [])
    if not views:
        return "Представлений пока нет — их создают в SimpleTest."
    return "\n".join(f"- `{v['id']}` — {v['name']}: JQL `{v['jql']}`, группировка {v.get('group_by') or '—'}"
                     for v in views)


def _render_groups(groups: list[dict], depth: int = 0, limit: int = 20) -> list[str]:
    out = []
    for g in groups:
        out.append("  " * depth + f"- **{g['value']}** — {g['count']}")
        if g.get("groups"):
            out += _render_groups(g["groups"], depth + 1, limit)
        elif g.get("issues"):
            for i in g["issues"][:limit]:
                vals = " · ".join(v for k, v in i["values"].items() if k != "key" and v)
                out.append("  " * (depth + 1) + f"- {i['key']}: {vals[:160]}")
    return out


@mcp.tool(annotations=READ)
async def simpletest_jira_view_run(view_id: str, refresh: bool = False) -> str:
    """Выполнить представление Jira-аналитики: задачи, сгруппированные по полям.

    refresh=True — мимо 3-минутного кэша SimpleTest.
    """
    try:
        views = (await _simpletest.request("GET", "/api/jira/views")).get("views", [])
        view = next((v for v in views if v.get("id") == view_id), None)
        if not view:
            raise ToolError(f"Представление {view_id} не найдено — список: simpletest_jira_views.")
        res = await _simpletest.request("POST", "/api/jira/views/query", json={
            "jql": view["jql"], "columns": view["columns"], "group_by": view["group_by"], "refresh": refresh})
    except SimpleTestError as e:
        raise _fail(e)
    head = f"# {view['name']}\nЗадач: {res['total']}" + (" (показаны первые 1000)" if res.get("truncated") else "")
    if res.get("groups"):
        return head + "\n\n" + "\n".join(_render_groups(res["groups"]))
    issues = res.get("issues", [])[:100]
    return head + "\n\n" + "\n".join(
        f"- {i['key']}: " + " · ".join(v for k, v in i["values"].items() if k != "key" and v)[:200] for i in issues)


# ══ Анализатор логов и веб-коннекторы SimpleTest ═════════════════════════════

def _render_run(res: dict) -> str:
    name = res.get("scenario", {}).get("name", res.get("source", ""))
    output = res.get("output", "logs")
    if output == "data":
        data = res.get("data")
        text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, indent=2)
        return f"## {name}\nИсточник: {res.get('source', '')}\n```\n{text[:20000]}\n```"
    if output == "text":
        return f"## {name}\nСтраница: {res.get('url', '')}\n\n{(res.get('text') or '')[:20000]}"
    head = (f"## {res['service'] or 'без сервиса'} · последние {res['minutes']} мин\n"
            f"Источник: {name} · строк {res['lines']}, ошибок {res['errors']}, групп {len(res['groups'])}")
    return head + "\n\n" + render_markdown(res, top=10)


@mcp.tool(annotations=READ)
async def logs_analyze(service: str, minutes: int = 10) -> str:
    """Ошибки микросервиса за последние N минут — главный инструмент для логов.

    Логи выгружает сценарий веб-коннектора SimpleTest, отмеченный «Источник для
    анализатора» (записан человеком в SimpleTest: Генераторы событий → Веб-коннекторы),
    под сессией пользователя. Ошибки сгруппированы по причине, с важностью и стеком.
    """
    try:
        res = await _simpletest.request("POST", "/api/log-analyzer/run", json={"service": service, "minutes": minutes})
    except SimpleTestError as e:
        raise _fail(e)
    return _render_run(res)


@mcp.tool(annotations=READ)
async def logs_saved_services() -> str:
    """Сохранённые в SimpleTest имена микросервисов и текущий источник логов."""
    try:
        st = await _simpletest.request("GET", "/api/log-analyzer")
    except SimpleTestError as e:
        raise _fail(e)
    src = st.get("source")
    lines = [f"Источник логов: {src['name']} · {src['connector']}" if src else "Источник логов не настроен."]
    lines += [f"- {s['name']}" + (f" — {s['note']}" if s.get("note") else "") for s in st.get("services", [])]
    return "\n".join(lines)


@mcp.tool(annotations=READ)
async def web_scenarios() -> str:
    """Веб-коннекторы и записанные операции SimpleTest: id и параметры для web_run."""
    try:
        d = await _simpletest.request("GET", "/api/webconnect")
    except SimpleTestError as e:
        raise _fail(e)
    names = {c["id"]: c["name"] for c in d.get("connectors", [])}
    if not d.get("scenarios"):
        return "Сценариев нет — их записывают в SimpleTest: Генераторы событий → Веб-коннекторы."
    def params(s: dict) -> str:
        ps = s.get("params") or []
        return ", ".join(f"{p['name']} ({p.get('label') or p['name']})" for p in ps) or "без параметров"
    return "\n".join(f"- `{s['id']}` — {s['name']} ({names.get(s['connector_id'], '?')}); параметры: {params(s)}"
                     + ("; окно времени" if s.get("window") else "")
                     + (" · источник анализатора" if s.get("log_source") else "") for s in d["scenarios"])


@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, open_world_hint=True))
async def web_run(scenario_id: str, params: Optional[dict[str, str]] = None, minutes: int = 10) -> str:
    """Запустить операцию веб-коннектора SimpleTest с параметрами (имена — из web_scenarios).

    Незаполненный параметр берётся из записи. minutes — окно «последние N минут», если оно есть
    в операции. Операция может что-то менять на ресурсе (повтор действий человека) — запускайте
    только то, о чём просил пользователь.
    """
    try:
        res = await _simpletest.request("POST", f"/api/webconnect/scenarios/{scenario_id}/run",
                                        json={"values": params or {}, "minutes": minutes})
    except SimpleTestError as e:
        raise _fail(e)
    return _render_run(res)


# ══ dropup (OpenShift) ═══════════════════════════════════════════════════════

@mcp.tool(annotations=READ)
async def dropup_status() -> str:
    """Есть ли сессия в консоли dropup и под кем. Начинать работу с логами отсюда."""
    if not _console.base_url:
        raise ToolError("Не задан DROPUP_CONSOLE_URL в env MCP-сервера.")
    try:
        user = await _console.whoami()
    except ConsoleError as e:
        raise _fail(e)
    if not user:
        return f"Консоль: {_console.base_url}\nСессии нет — вызови dropup_login."
    return f"Консоль: {_console.base_url}\nВход выполнен: {user}"


@mcp.tool(annotations=ToolAnnotations(read_only_hint=True, open_world_hint=True))
async def dropup_login(wait_seconds: int = 300) -> str:
    """Открыть окно консоли dropup, чтобы пользователь вошёл сам (SSO/пароль вводит человек).

    Ждёт входа до wait_seconds, затем закрывает окно; сессия сохраняется в профиле
    браузера и используется дальше в фоне. Агент данные входа не вводит.
    """
    try:
        user = await _console.login(wait_seconds)
    except ConsoleError as e:
        raise _fail(e)
    return f"Вход выполнен: {user}. Сессия сохранена, дальше работаем в фоне."


@mcp.tool(annotations=READ)
async def dropup_projects() -> str:
    """Проекты (namespace) dropup, доступные пользователю. Обычно стенд = проект."""
    try:
        projects = await _console.list_projects()
    except ConsoleError as e:
        raise _fail(e)
    return f"Проектов: {len(projects)}\n" + "\n".join(f"- {p}" for p in projects)


def _image_tag(image: str) -> str:
    tail = image.rsplit("/", 1)[-1]
    return tail.split("@")[0]


@mcp.tool(annotations=READ)
async def dropup_services(namespace: str) -> str:
    """Микросервисы проекта: тип, готовность подов, образ (версия сборки)."""
    try:
        services = await _console.list_services(namespace)
    except ConsoleError as e:
        raise _fail(e)
    if not services:
        return f"В {namespace} сервисов не найдено."
    rows = ["| Сервис | Тип | Готово | Образ |", "|---|---|---|---|"]
    for s in services:
        mark = "" if s["ready"] >= (s["replicas"] or 0) else " ⚠"
        rows.append(f"| {s['name']} | {s['kind']} | {s['ready']}/{s['replicas']}{mark} | "
                    f"{', '.join(_image_tag(i) for i in s['images'])} |")
    return "\n".join(rows)


@mcp.tool(annotations=READ)
async def dropup_pods(namespace: str, service: str) -> str:
    """Поды сервиса: статус, рестарты, причина ожидания (CrashLoopBackOff, ImagePullBackOff…)."""
    try:
        pods = await _console.pods_for_service(namespace, service)
    except ConsoleError as e:
        raise _fail(e)
    if not pods:
        return f"У {service} нет подов."
    return "\n".join(
        f"- {p['name']}: {p['phase']}, {'готов' if p['ready'] else 'НЕ готов'}, рестартов {p['restarts']}"
        + (f", ожидание: {', '.join(p['waiting'])}" if p["waiting"] else "") for p in pods)


@mcp.tool(annotations=READ)
async def dropup_logs(namespace: str, service: str, since_minutes: int = 15,
                      grep: str = "", max_lines: int = 300) -> str:
    """Сырые строки логов всех подов сервиса за последние since_minutes.

    grep — регулярное выражение-фильтр (без учёта регистра); max_lines — сколько
    последних строк вернуть. Для разбора ошибок лучше dropup_triage.
    """
    try:
        _, lines = await _console.service_logs(namespace, service, since_minutes)
    except ConsoleError as e:
        raise _fail(e)
    if grep:
        try:
            rx = re.compile(grep, re.I)
        except re.error as e:
            raise ToolError(f"Неверное выражение grep: {e}")
        lines = [(p, l) for p, l in lines if rx.search(l)]
    tail = lines[-max_lines:]
    head = f"Строк: {len(lines)}" + (f", показаны последние {len(tail)}" if len(lines) > len(tail) else "")
    return head + "\n```\n" + "\n".join(f"[{p}] {l}" for p, l in tail) + "\n```"


def _pod_health(pods: list[dict]) -> str:
    bad = [p for p in pods if not p["ready"] or p["waiting"]]
    restarts = sum(p["restarts"] for p in pods)
    text = f"Подов: {len(pods)}, не готовы: {len(bad)}, рестартов: {restarts}"
    waits = sorted({w for p in pods for w in p["waiting"]})
    return text + (f", ожидание: {', '.join(waits)}" if waits else "")


@mcp.tool(annotations=READ)
async def dropup_triage(namespace: str, service: str, since_minutes: int = 15, top: int = 10) -> str:
    """Разбор логов сервиса: ошибки сгруппированы по причине (отпечатку), от важных к мелким.

    Повторы склеиваются: числа, UUID, время и id в тексте не дробят одну ошибку на тысячи.
    Важность: critical — падение/память, high — ≥50 повторов, medium — ≥5, low — единичные.
    """
    try:
        pods, lines = await _console.service_logs(namespace, service, since_minutes)
    except ConsoleError as e:
        raise _fail(e)
    result = triage(lines)
    return (render_markdown(result, top=top, title=f"{service} · {namespace} · {since_minutes} мин")
            + "\n\n" + _pod_health(pods))


@mcp.tool(annotations=READ)
async def dropup_check(namespace: str, services: Optional[list[str]] = None, since_minutes: int = 15) -> str:
    """Сводка по стенду: для каждого сервиса — поды, рестарты, число ошибок и главная ошибка.

    services — список имён; пусто — все сервисы проекта (не больше 20 за раз).
    """
    try:
        names = services or [s["name"] for s in await _console.list_services(namespace)]
    except ConsoleError as e:
        raise _fail(e)
    names = names[:20]
    rows = ["| Сервис | Поды | Рестарты | Ошибок | Групп | Главная ошибка |", "|---|---|---|---|---|---|"]
    for name in names:
        try:
            pods, lines = await _console.service_logs(namespace, name, since_minutes)
        except ConsoleError as e:
            rows.append(f"| {name} | — | — | — | — | {str(e)[:80]} |")
            continue
        res = triage(lines)
        ready = sum(1 for p in pods if p["ready"])
        top = res["groups"][0] if res["groups"] else None
        top_text = (f"{top['severity']}: {(top['exception'] or top['message'])[:70]} ×{top['count']}"
                    .replace("|", "\\|") if top else "—")
        mark = "🔴" if top and top["severity"] in ("critical", "high") or ready < len(pods) else (
            "🟡" if res["errors"] else "🟢")
        rows.append(f"| {mark} {name} | {ready}/{len(pods)} | {sum(p['restarts'] for p in pods)} | "
                    f"{res['errors']} | {len(res['groups'])} | {top_text} |")
    return f"Проект {namespace}, последние {since_minutes} мин\n\n" + "\n".join(rows)
