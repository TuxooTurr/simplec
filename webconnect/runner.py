"""
Запуск операции: шаблон + параметры (+ окно времени) → результат.

Виды операций:
- request  — повтор записанного запроса сайта (Kibana, Loki, любой API) с подстановкой;
- k8s_logs — консоль OpenShift: поды сервиса находятся по селектору, логи берутся у каждого;
- steps    — повтор действий: открыть страницу, ввести, нажать, забрать текст/скриншот.

Вид результата (output):
- logs — строки → разбор ошибок по причине (log_triage);
- data — ответ как есть (JSON или текст);
- text — текст страницы/элемента и скриншот (для шагов).

Вход: если сессия истекла, а у коннектора задан вход по логину и паролю и форма
входа известна из записи — входим сами и повторяем операцию один раз.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any, Optional
from urllib.parse import quote, urlencode

from mcp_server.dropup import parse_pods, parse_workloads, selector_to_query
from mcp_server.log_triage import triage

from .browser import ConnectorWindow, NeedLogin, WebError, _origin
from .extract import extract_lines
from .secrets import SecretError, decrypt
from .templates import render

K8S = "/api/kubernetes"
MAX_DATA = 200_000          # данные в ответе операции — до 200 КБ текста
MAX_TEXT = 50_000


async def _get_json(window: ConnectorWindow, url: str) -> dict:
    status, ctype, text, _ = await window.fetch("GET", url, None, {"Accept": "application/json"})
    _check(status, ctype, text, url)
    try:
        return json.loads(text)
    except ValueError as e:
        raise WebError(f"Ответ {url} не JSON: {text[:200]}") from e


def _check(status: int, ctype: str, text: str, url: str) -> None:
    if status in (401, 407) or (status == 200 and "html" in ctype and "<form" in text.lower() and "password" in text.lower()):
        raise NeedLogin("Сессия истекла — нажмите «Войти» в веб-коннекторе и войдите заново.")
    if status == 403:
        raise WebError(f"Нет прав (403) на {url.split('?')[0]}.")
    if status == 404:
        raise WebError(f"Не найдено (404): {url.split('?')[0]} — проверьте параметры операции.")
    if status >= 400:
        raise WebError(f"Ресурс ответил {status}: {text[:300]}")


# ── Вход по логину и паролю ──────────────────────────────────────────────────

def can_auto_login(connector: dict) -> bool:
    auth = connector.get("auth") or {}
    recipe = auth.get("recipe") or {}
    return auth.get("mode") == "password" and bool(auth.get("password_enc")) and bool(recipe.get("password_selector"))


async def auto_login(window: ConnectorWindow) -> None:
    """Входит по записанной форме входа логином и паролем техучётки."""
    c = window.connector
    auth = c["auth"]
    recipe = auth["recipe"]
    try:
        password = decrypt(auth["password_enc"])
    except SecretError as e:
        raise WebError(str(e)) from e
    page = window._page
    await page.goto(recipe.get("login_url") or c["base_url"], wait_until="domcontentloaded")
    if recipe.get("user_selector"):
        await page.fill(recipe["user_selector"], auth.get("login", ""))
    await page.fill(recipe["password_selector"], password)
    submit = recipe.get("submit")
    if submit and submit["type"] == "click":
        await page.click(submit["selector"])
    else:
        await page.press(recipe["password_selector"], (submit or {}).get("key") or "Enter")
    try:
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(800)
    except Exception:
        pass
    # Если поле пароля всё ещё на экране — вход не прошёл (неверный пароль, капча, 2FA).
    if await page.locator(recipe["password_selector"]).count() and await page.locator(recipe["password_selector"]).first.is_visible():
        raise NeedLogin("Вход по логину и паролю не прошёл: проверьте пароль техучётки. Если на ресурсе "
                        "двухфакторная авторизация или капча — переключите коннектор на вход вручную.")
    await window._save_cookies()


# ── Виды операций ────────────────────────────────────────────────────────────

async def _k8s_lines(window: ConnectorWindow, base: str, op: dict, service: str,
                     minutes: int) -> list[tuple[Optional[str], str]]:
    ns = quote(op["namespace"], safe="")
    deployments = await _get_json(window, f"{base}{K8S}/apis/apps/v1/namespaces/{ns}/deployments")
    services = {s["name"]: s for s in parse_workloads(deployments)}
    svc = services.get(service)
    selector = selector_to_query(svc["selector"]) if svc and svc["selector"] else f"app={service}"
    pods = parse_pods(await _get_json(window, f"{base}{K8S}/api/v1/namespaces/{ns}/pods?"
                                              + urlencode({"labelSelector": selector})))
    if not pods:
        raise WebError(f"У сервиса «{service}» нет подов в проекте {op['namespace']}.")
    lines: list[tuple[Optional[str], str]] = []
    for pod in pods:
        container = op.get("container") or (pod["containers"][0] if pod["containers"] else "")
        params = {"sinceSeconds": str(minutes * 60), "timestamps": "true", "tailLines": "5000"}
        if container and container in pod["containers"]:
            params["container"] = container
        url = f"{base}{K8S}/api/v1/namespaces/{ns}/pods/{quote(pod['name'], safe='')}/log?{urlencode(params)}"
        status, ctype, text, _ = await window.fetch("GET", url, None, {})
        if status >= 400:
            lines.append((pod["name"], f"ERROR [simpletest] логи пода недоступны: HTTP {status}"))
            continue
        lines += [(pod["name"], l) for l in text.splitlines()]
    return lines


async def _request(window: ConnectorWindow, op: dict, values: dict, minutes: int) -> tuple[str, str, str]:
    req = op["request"]
    url = render(req["url"], values, minutes)
    body = render(req["body"], values, minutes) if req.get("body") else None
    status, ctype, text, final_url = await window.fetch(req["method"], url, body, req.get("headers") or {})
    if _origin(final_url) != _origin(url):
        raise NeedLogin("Ресурс перенаправил на вход — нажмите «Войти» и войдите заново.")
    _check(status, ctype, text, url)
    return text, ctype, url.split("?")[0]


async def _steps(window: ConnectorWindow, op: dict, values: dict, minutes: int) -> dict:
    page = window._page
    start = render(op.get("start_url") or window.connector["base_url"], values, minutes)
    await page.goto(start, wait_until="domcontentloaded")
    # Страница входа может быть и на том же адресе — узнаём её по полю пароля.
    if _origin(page.url) != _origin(start) or await page.locator("input[type=password]").count():
        raise NeedLogin("Ресурс отправил на страницу входа.")
    for i, s in enumerate(op.get("steps") or [], 1):
        sel = s.get("selector") or ""
        try:
            if s["type"] == "goto":
                await page.goto(render(s.get("url", ""), values, minutes), wait_until="domcontentloaded")
            elif s["type"] == "fill":
                await page.fill(sel, render(s.get("value", ""), values, minutes))
            elif s["type"] == "press":
                await page.press(sel, s.get("key") or "Enter")
            elif s["type"] == "click":
                try:
                    await page.click(sel, timeout=10_000)
                except Exception:
                    # Запасной путь: элемент с тем же текстом (селектор мог поменяться).
                    if not s.get("text"):
                        raise
                    await page.get_by_text(s["text"], exact=True).first.click(timeout=10_000)
        except Exception as e:
            if await page.locator("input[type=password]").count():
                raise NeedLogin("Во время шагов открылась страница входа.") from e
            raise WebError(f"Шаг {i} ({s['type']} {sel or s.get('url', '')}) не выполнился: {str(e).splitlines()[0][:200]}") from e
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=15_000)
        except Exception:
            pass
        await page.wait_for_timeout(300)

    wait_sel = op.get("extract_selector") or ""
    if wait_sel:
        try:
            await page.wait_for_selector(wait_sel, timeout=15_000)
            text = await page.locator(wait_sel).first.inner_text()
        except Exception as e:
            raise WebError(f"Элемент результата «{wait_sel}» не появился: {str(e).splitlines()[0][:200]}") from e
    else:
        await page.wait_for_timeout(700)
        text = await page.locator("body").inner_text()
    shot = await page.screenshot(type="jpeg", quality=60)
    return {"text": text[:MAX_TEXT], "url": page.url, "screenshot": base64.b64encode(shot).decode("ascii")}


async def _execute(window: ConnectorWindow, op: dict, values: dict, minutes: int) -> dict:
    kind = op["kind"]
    output = op.get("output") or ("text" if kind == "steps" else "logs")
    if kind == "k8s_logs":
        service = values.get("service") or next(iter(values.values()), "")
        lines = await _k8s_lines(window, window.connector["base_url"].rstrip("/"), op, service, minutes)
        return {"output": "logs", "source": f"OpenShift · {op['namespace']}", "_lines": lines}
    if kind == "steps":
        res = await _steps(window, op, values, minutes)
        if output == "logs":
            return {"output": "logs", "source": res["url"], "_lines": [(None, l) for l in res["text"].splitlines()]}
        return {"output": "text", "source": res["url"], **res}
    text, ctype, source = await _request(window, op, values, minutes)
    if output == "logs":
        return {"output": "logs", "source": source, "_lines": extract_lines(text, ctype)}
    data: Any = text[:MAX_DATA]
    if "json" in ctype or text.lstrip()[:1] in ("{", "["):
        try:
            data = json.loads(text)
        except ValueError:
            pass
    return {"output": "data", "source": source, "data": data, "content_type": ctype, "size": len(text)}


async def run_operation(window: ConnectorWindow, op: dict, values: dict[str, str], minutes: int = 10) -> dict:
    """Повтор операции в фоновом браузере (тёплом между запусками)."""
    started = time.time()
    async with window.lock:
        await window.open(headless=True, mode="run")
        window.mode = "run"
        try:
            try:
                res = await _execute(window, op, values, minutes)
            except NeedLogin:
                if not can_auto_login(window.connector):
                    raise
                await auto_login(window)
                res = await _execute(window, op, values, minutes)
                res["relogged"] = True
        except Exception:
            await window.close()      # после ошибки — чистый старт в следующий раз
            raise
        window.keep_warm()

    out = {"values": values, "minutes": minutes, "seconds": round(time.time() - started, 1), **res}
    # Совместимость с анализатором логов: сервис — отдельным полем.
    out["service"] = values.get("service") or next(iter(values.values()), "")
    lines = out.pop("_lines", None)
    if lines is not None:
        out.update(triage(lines))
        out["lines"] = len(lines)
        out["sample"] = [f"[{p}] {l}" if p else l for p, l in lines[-20:]]
    return out


async def run_scenario(window: ConnectorWindow, scenario: dict, service: str, minutes: int = 10) -> dict:
    """Старое имя: один параметр «сервис». Оставлено для совместимости."""
    return await run_operation(window, scenario, {"service": service} if service else {}, minutes)
