"""
Web-коннектор к консоли OpenShift (dropup) через браузер с сессией пользователя.

Прямого доступа к API кластера нет, но сама веб-консоль получает данные через
собственный прокси Kubernetes API (`<консоль>/api/kubernetes/...`) под сессией
вошедшего человека. Коннектор делает то же самое: открывает страницу консоли в
браузере (Playwright, постоянный профиль) и вызывает `fetch` изнутри неё. Поэтому:

- пароль нигде не хранится — человек один раз входит сам в открывшемся окне,
  сессия живёт в профиле браузера (~/.simpletest/mcp-web/profile);
- работают сертификаты и прокси, которым доверяет установленный Chrome;
- права те же, что у пользователя в консоли, — не больше.

Разбор ответов Kubernetes вынесен в чистые функции (parse_*) — их проверяют тесты
без браузера.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlencode

K8S = "/api/kubernetes"


class ConsoleError(Exception):
    """Понятная пользователю ошибка: что случилось и что сделать."""


class NotLoggedIn(ConsoleError):
    pass


# ── Разбор ответов Kubernetes (без сети) ─────────────────────────────────────

def selector_to_query(selector: dict[str, str]) -> str:
    """matchLabels → labelSelector: {"app": "pay", "tier": "api"} → "app=pay,tier=api"."""
    return ",".join(f"{k}={v}" for k, v in sorted(selector.items()))


def parse_workloads(*lists: dict) -> list[dict]:
    """Deployment/StatefulSet/DeploymentConfig → сервисы: имя, тип, готовность, образы, селектор."""
    out = []
    for lst in lists:
        for item in (lst or {}).get("items", []) or []:
            meta = item.get("metadata", {})
            spec = item.get("spec", {})
            status = item.get("status", {})
            sel = (spec.get("selector") or {})
            match = sel.get("matchLabels") if isinstance(sel.get("matchLabels"), dict) else (
                sel if sel and all(isinstance(v, str) for v in sel.values()) else {})
            containers = (((spec.get("template") or {}).get("spec") or {}).get("containers")) or []
            out.append({
                "name": meta.get("name", ""),
                "kind": item.get("kind") or lst.get("kind", "").removesuffix("List") or "Deployment",
                "replicas": spec.get("replicas", 0),
                "ready": status.get("readyReplicas", 0) or 0,
                "images": [c.get("image", "") for c in containers],
                "selector": match or {},
            })
    return sorted(out, key=lambda s: s["name"])


def parse_pods(pods_json: dict) -> list[dict]:
    """Список подов: имя, фаза, готовность, рестарты, контейнеры, причина ожидания (CrashLoop…)."""
    out = []
    for item in (pods_json or {}).get("items", []) or []:
        meta = item.get("metadata", {})
        status = item.get("status", {})
        cstat = status.get("containerStatuses") or []
        waiting = [
            (c.get("state") or {}).get("waiting", {}).get("reason", "")
            for c in cstat if (c.get("state") or {}).get("waiting")
        ]
        out.append({
            "name": meta.get("name", ""),
            "phase": status.get("phase", ""),
            "ready": all(c.get("ready") for c in cstat) if cstat else False,
            "restarts": sum(int(c.get("restartCount", 0) or 0) for c in cstat),
            "containers": [c.get("name", "") for c in (item.get("spec", {}).get("containers") or [])],
            "waiting": [w for w in waiting if w],
            "started": status.get("startTime", ""),
        })
    return sorted(out, key=lambda p: p["name"])


# ── Клиент консоли ───────────────────────────────────────────────────────────

def _env_bool(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")


class ConsoleClient:
    """Один браузер на процесс. Все вызовы последовательны (общая страница)."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        profile_dir: Optional[str] = None,
        channel: Optional[str] = None,
        executable_path: Optional[str] = None,
        timeout_ms: int = 30_000,
    ):
        self.base_url = (base_url or os.environ.get("DROPUP_CONSOLE_URL", "")).rstrip("/")
        self.profile_dir = Path(profile_dir or os.environ.get(
            "MCP_WEB_PROFILE_DIR", str(Path.home() / ".simpletest" / "mcp-web" / "profile"))).expanduser()
        # Сессионные cookie (без срока годности) браузер не пишет в профиль и теряет,
        # когда окно входа закрывается. Сохраняем их сами — рядом с профилем, 0600.
        self.session_file = self.profile_dir.parent / "session-cookies.json"
        # По умолчанию — установленный Google Chrome: Playwright не нужно скачивать
        # свой браузер (в корп. сети загрузка браузеров Playwright обычно закрыта).
        self.channel = channel if channel is not None else os.environ.get("MCP_WEB_BROWSER_CHANNEL", "chrome")
        self.executable_path = executable_path or os.environ.get("MCP_WEB_BROWSER_PATH") or None
        self.ignore_https = _env_bool("MCP_WEB_IGNORE_HTTPS_ERRORS")
        self.timeout_ms = timeout_ms
        self._pw = None
        self._ctx = None
        self._page = None
        self._headless: Optional[bool] = None
        self._lock = asyncio.Lock()

    # ── браузер ──

    def _require_url(self) -> None:
        if not self.base_url:
            raise ConsoleError(
                "Не задан адрес консоли dropup. Укажи DROPUP_CONSOLE_URL в env MCP-сервера, "
                "например https://console-openshift-console.apps.<кластер>")

    async def _open(self, headless: bool) -> None:
        if self._ctx is not None and self._headless == headless:
            return
        await self._close_browser()
        try:
            from playwright.async_api import async_playwright
        except ImportError as e:
            raise ConsoleError("Не установлен Playwright — выполните «pip install -r requirements.txt» "
                               "в окружении MCP-сервера и перезапустите его.") from e

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self._pw = await async_playwright().start()
        kwargs: dict[str, Any] = {
            "headless": headless,
            "ignore_https_errors": self.ignore_https,
            "viewport": {"width": 1280, "height": 860},
        }
        if self.executable_path:
            kwargs["executable_path"] = self.executable_path
        elif self.channel:
            kwargs["channel"] = self.channel
        try:
            self._ctx = await self._pw.chromium.launch_persistent_context(str(self.profile_dir), **kwargs)
        except Exception as e:
            await self._close_browser()
            raise ConsoleError(
                f"Не удалось запустить браузер ({self.executable_path or self.channel or 'chromium'}): {e}. "
                "Проверь, что установлен Google Chrome, или укажи MCP_WEB_BROWSER_PATH. "
                "Если профиль занят — закрой другое окно этого MCP-сервера.") from e
        self._ctx.set_default_timeout(self.timeout_ms)
        await self._restore_cookies()
        self._page = self._ctx.pages[0] if self._ctx.pages else await self._ctx.new_page()
        self._headless = headless

    async def _save_cookies(self) -> None:
        cookies = await self._ctx.cookies()
        self.session_file.parent.mkdir(parents=True, exist_ok=True)
        self.session_file.write_text(json.dumps(cookies), encoding="utf-8")
        os.chmod(self.session_file, 0o600)

    async def _restore_cookies(self) -> None:
        if not self.session_file.exists():
            return
        try:
            cookies = json.loads(self.session_file.read_text(encoding="utf-8"))
            if cookies:
                await self._ctx.add_cookies(cookies)
        except Exception:
            # Битый файл — просто войдём заново; не повод падать.
            self.session_file.unlink(missing_ok=True)

    async def _close_browser(self) -> None:
        try:
            if self._ctx is not None:
                await self._ctx.close()
        finally:
            self._ctx = self._page = None
            if self._pw is not None:
                await self._pw.stop()
                self._pw = None
            self._headless = None

    async def close(self) -> None:
        async with self._lock:
            await self._close_browser()

    async def _ensure_origin(self) -> None:
        """fetch с куками сессии возможен только со страницы того же адреса."""
        url = self._page.url or ""
        if not url.startswith(self.base_url):
            # Лёгкая страница консоли — версия API; SPA целиком грузить не нужно.
            await self._page.goto(self.base_url + K8S + "/version", wait_until="domcontentloaded")

    async def _fetch(self, path: str) -> tuple[int, str, str]:
        return await self._page.evaluate(
            """async (path) => {
                const r = await fetch(path, {credentials: "same-origin", headers: {Accept: "application/json"}});
                return [r.status, r.headers.get("content-type") || "", await r.text()];
            }""",
            path,
        )

    async def _get(self, path: str, params: Optional[dict] = None, expect_json: bool = True) -> Any:
        self._require_url()
        await self._open(headless=True)
        await self._ensure_origin()
        full = K8S + path + (("?" + urlencode({k: v for k, v in params.items() if v is not None})) if params else "")
        status, ctype, text = await self._fetch(full)
        # Без сессии консоль отвечает 401/403 или отдаёт HTML страницы входа.
        if status in (401, 403) and "forbidden" not in text.lower():
            raise NotLoggedIn("Сессия dropup отсутствует или истекла — вызови dropup_login и войди в открывшемся окне.")
        if expect_json and "json" not in ctype and text.lstrip().startswith("<"):
            raise NotLoggedIn("Консоль вернула страницу входа — вызови dropup_login и войди в открывшемся окне.")
        if status == 403:
            raise ConsoleError(f"Нет прав на {path} (403). Проверь, что у твоей учётки есть доступ к проекту.")
        if status == 404:
            raise ConsoleError(f"Не найдено: {path} (404). Проверь имя проекта (namespace) и сервиса.")
        if status >= 400:
            raise ConsoleError(f"Консоль ответила {status} на {path}: {text[:300]}")
        if not expect_json:
            return text
        try:
            return json.loads(text)
        except ValueError as e:
            raise ConsoleError(f"Ответ {path} не JSON: {text[:200]}") from e

    # ── вход ──

    async def whoami(self) -> Optional[str]:
        try:
            async with self._lock:
                data = await self._get("/apis/user.openshift.io/v1/users/~")
        except NotLoggedIn:
            return None
        return (data.get("metadata") or {}).get("name") or data.get("fullName") or "unknown"

    async def login(self, wait_seconds: int = 300) -> str:
        """Открывает окно консоли, ждёт, пока человек войдёт, и возвращается в фон."""
        self._require_url()
        async with self._lock:
            await self._open(headless=False)
            await self._page.goto(self.base_url, wait_until="domcontentloaded")
            loop = asyncio.get_running_loop()
            deadline = loop.time() + wait_seconds
            user = None
            while loop.time() < deadline:
                try:
                    status, ctype, text = await self._fetch(K8S + "/apis/user.openshift.io/v1/users/~")
                    if status == 200 and "json" in ctype:
                        user = (json.loads(text).get("metadata") or {}).get("name") or "unknown"
                        break
                except Exception:
                    pass  # страница входа ещё грузится или редиректит
                await asyncio.sleep(2)
            if user:
                await self._save_cookies()
            await self._close_browser()   # дальше работаем в фоне с сохранённой сессией
        if not user:
            raise ConsoleError(f"Вход не завершён за {wait_seconds} с. Повтори dropup_login.")
        return user

    # ── данные ──

    async def list_projects(self) -> list[str]:
        async with self._lock:
            data = await self._get("/apis/project.openshift.io/v1/projects")
        return sorted((i.get("metadata") or {}).get("name", "") for i in data.get("items", []))

    async def list_services(self, namespace: str) -> list[dict]:
        ns = quote(namespace, safe="")
        async with self._lock:
            lists = [await self._get(f"/apis/apps/v1/namespaces/{ns}/deployments")]
            for extra in (f"/apis/apps/v1/namespaces/{ns}/statefulsets",
                          f"/apis/apps.openshift.io/v1/namespaces/{ns}/deploymentconfigs"):
                try:
                    lists.append(await self._get(extra))
                except NotLoggedIn:
                    raise
                except ConsoleError:
                    pass  # тип ресурса не включён в кластере или нет прав — не критично
        return parse_workloads(*lists)

    async def pods_for_service(self, namespace: str, service: str) -> list[dict]:
        services = {s["name"]: s for s in await self.list_services(namespace)}
        svc = services.get(service)
        selector = selector_to_query(svc["selector"]) if svc and svc["selector"] else f"app={service}"
        ns = quote(namespace, safe="")
        async with self._lock:
            data = await self._get(f"/api/v1/namespaces/{ns}/pods", {"labelSelector": selector})
        pods = parse_pods(data)
        if not pods and not svc:
            raise ConsoleError(f"Сервис «{service}» не найден в {namespace}. Список — dropup_services.")
        return pods

    async def pod_logs(self, namespace: str, pod: str, container: Optional[str] = None,
                       since_minutes: int = 15, tail_lines: int = 3000, previous: bool = False) -> list[str]:
        ns, p = quote(namespace, safe=""), quote(pod, safe="")
        params = {
            "container": container, "sinceSeconds": str(max(1, since_minutes) * 60),
            "tailLines": str(tail_lines), "timestamps": "true",
            "previous": "true" if previous else None,
        }
        async with self._lock:
            text = await self._get(f"/api/v1/namespaces/{ns}/pods/{p}/log", params, expect_json=False)
        return text.splitlines()

    async def service_logs(self, namespace: str, service: str, since_minutes: int = 15,
                           tail_lines: int = 3000) -> tuple[list[dict], list[tuple[str, str]]]:
        """Логи всех подов сервиса (первый контейнер каждого) → (поды, [(под, строка)])."""
        pods = await self.pods_for_service(namespace, service)
        lines: list[tuple[str, str]] = []
        for pod in pods:
            container = pod["containers"][0] if pod["containers"] else None
            try:
                for line in await self.pod_logs(namespace, pod["name"], container, since_minutes, tail_lines):
                    lines.append((pod["name"], line))
            except NotLoggedIn:
                raise
            except ConsoleError as e:
                lines.append((pod["name"], f"ERROR [simpletest-mcp] логи пода недоступны: {e}"))
        return pods, lines
