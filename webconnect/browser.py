"""
Окно браузера коннектора: вход человеком, запись действий и повтор сценария.

Один процесс бэкенда SimpleTest владеет браузерами коннекторов: профиль браузера
может открыть только один процесс. MCP-сервер ходит сюда через API SimpleTest.

- Вход и запись — видимое окно Chrome на компьютере пользователя. Пароль вводит
  человек, мы его не видим: значения полей пароля в запись не попадают.
- Запись — шаги (клики, ввод, Enter, переходы) и ответы сайта на его собственные
  запросы (XHR/fetch) и выгрузки файлов. Из них потом выбирается «источник данных».
- Повтор — фоновый браузер с той же сессией: открывает адрес ресурса и делает
  запрос изнутри страницы (`fetch`), как это делает сам сайт.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

from .extract import log_likeness

_PROFILES = Path(os.environ.get("WEBCONNECT_HOME", str(Path.home() / ".simpletest" / "webconnect"))).expanduser()

MAX_BODY = 2_000_000          # тело ответа в записи — до 2 МБ
IDLE_CLOSE_SECONDS = 600      # фоновый браузер живёт 10 минут после последнего запуска

# Запуск настоящего Chrome с профилем — 7–25 с. Эти флаги убирают первый запуск,
# расширения и фоновые сетевые задачи, которые запуску не нужны.
_LAUNCH_ARGS = ["--no-first-run", "--no-default-browser-check", "--disable-extensions",
                "--disable-component-update", "--disable-background-networking", "--disable-sync",
                "--disable-features=Translate,OptimizationHints,MediaRouter"]
MAX_RESPONSES = 300
_STATIC_EXT = (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".map")


class WebError(Exception):
    """Понятная пользователю ошибка."""


class NeedLogin(WebError):
    pass


MISSING_PLAYWRIGHT = (
    "Не установлен Playwright — без него веб-коннектор не может открыть браузер. "
    "В окружении, где запущен бэкенд SimpleTest, выполните «pip install -r requirements.txt» "
    "(или «pip install playwright») и перезапустите бэкенд. Скачивать браузер не нужно — "
    "используется установленный Google Chrome."
)


# Скрипт записи: клики, ввод, Enter. Пароли не записываются — только факт ввода.
_RECORDER_JS = r"""
(() => {
  if (window.__stRecInstalled) return; window.__stRecInstalled = true;
  const send = (ev) => { try { window.__stRecord && window.__stRecord(ev); } catch (e) {} };
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return "";
    for (const a of ["data-testid", "data-test", "data-qa", "id", "name", "aria-label", "placeholder"]) {
      const v = el.getAttribute(a);
      if (v && v.length < 80) return a === "id" ? "#" + CSS.escape(v) : `[${a}="${v.replace(/"/g, '\\"')}"]`;
    }
    const text = (el.innerText || "").trim();
    if (["BUTTON", "A"].includes(el.tagName) && text && text.length < 40) return `${el.tagName.toLowerCase()}:has-text("${text}")`;
    const parts = []; let e = el;
    while (e && e.nodeType === 1 && parts.length < 5) {
      let p = e.tagName.toLowerCase();
      if (e.parentElement) {
        const same = [...e.parentElement.children].filter(c => c.tagName === e.tagName);
        if (same.length > 1) p += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(p); e = e.parentElement;
    }
    return parts.join(" > ");
  };
  const target = (t) => t.closest && (t.closest("button,a,[role=button],[role=tab],[role=option],input,select,label,li") || t) || t;
  // Ввод фиксируем сами: событие change приходит только при уходе фокуса, а после
  // Enter страница часто уходит раньше — и значение терялось.
  const pending = new Map(), sent = new Map();
  const flush = (el) => {
    if (!pending.has(el)) return;
    const value = pending.get(el); pending.delete(el);
    if (sent.get(el) === value) return;
    sent.set(el, value);
    const secret = el.type === "password";
    send({type: "fill", selector: sel(el), value: secret ? "" : String(value).slice(0, 200), secret});
  };
  const flushAll = () => { for (const el of [...pending.keys()]) flush(el); };
  document.addEventListener("input", e => {
    const t = e.target;
    if (t.matches && t.matches("input,textarea,select")) pending.set(t, t.value);
  }, true);
  document.addEventListener("change", e => {
    const t = e.target;
    if (!t.matches || !t.matches("input,textarea,select")) return;
    pending.set(t, t.value); flush(t);
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    flushAll();
    send({type: "press", selector: sel(e.target), key: "Enter"});
  }, true);
  document.addEventListener("click", e => {
    flushAll();
    const el = target(e.target);
    send({type: "click", selector: sel(el), text: ((el.innerText || el.value || "") + "").trim().slice(0, 60)});
  }, true);
  window.addEventListener("pagehide", flushAll, true);
})();
"""


def _origin(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


class ConnectorWindow:
    def __init__(self, connector: dict):
        self.connector = connector
        self.profile_dir = _PROFILES / connector["id"] / "profile"
        self.session_file = _PROFILES / connector["id"] / "session-cookies.json"
        self.channel = os.environ.get("MCP_WEB_BROWSER_CHANNEL", "chrome")
        self.executable_path = os.environ.get("MCP_WEB_BROWSER_PATH") or None
        self._pw = self._ctx = self._page = None
        self.headless: Optional[bool] = None
        self.recording = False
        self.mode = ""                  # "login" | "record" | "run"
        self.steps: list[dict] = []
        self.responses: list[dict] = []
        self.started_at = 0.0
        self._saver: Optional[asyncio.Task] = None
        self._idle: Optional[asyncio.Task] = None
        self._closed = False            # окно закрыл сам человек
        self.lock = asyncio.Lock()

    # ── браузер ──

    @property
    def is_open(self) -> bool:
        return self._ctx is not None and not self._closed

    async def open(self, headless: bool, record: bool = False, mode: str = "") -> None:
        if self.is_open and self.headless == headless and self.recording == record:
            return
        await self.close()
        try:
            from playwright.async_api import async_playwright
        except ImportError as e:
            raise WebError(MISSING_PLAYWRIGHT) from e

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self._pw = await async_playwright().start()
        kwargs: dict[str, Any] = {"headless": headless, "args": _LAUNCH_ARGS}
        if headless:
            kwargs["viewport"] = {"width": 1280, "height": 860}
        else:
            kwargs["no_viewport"] = True          # окно человека — обычного размера
        if self.executable_path:
            kwargs["executable_path"] = self.executable_path
        elif self.channel:
            kwargs["channel"] = self.channel
        try:
            self._ctx = await self._pw.chromium.launch_persistent_context(str(self.profile_dir), **kwargs)
        except Exception as e:
            await self.close()
            raise WebError(f"Не удалось запустить браузер: {e}. Нужен Google Chrome или MCP_WEB_BROWSER_PATH; "
                           "если окно этого коннектора уже открыто — закройте его.") from e
        self._ctx.set_default_timeout(45_000)
        self._closed = False
        self._ctx.on("close", lambda *_: setattr(self, "_closed", True))
        await self._restore_cookies()
        self.headless, self.recording, self.mode = headless, record, mode
        self.steps, self.responses, self.started_at = [], [], time.time()
        if record:
            await self._ctx.expose_binding("__stRecord", self._on_step)
            await self._ctx.add_init_script(_RECORDER_JS)
            self._ctx.on("page", self._watch_page)
        self._page = self._ctx.pages[0] if self._ctx.pages else await self._ctx.new_page()
        if record:
            self._watch_page(self._page)
        if not headless:
            # Окно может закрыть сам человек — сессию сохраняем заранее и регулярно.
            self._saver = asyncio.create_task(self._autosave())

    def keep_warm(self) -> None:
        """Фоновый браузер не закрываем сразу: следующий запуск пройдёт за секунды."""
        if self._idle:
            self._idle.cancel()

        async def later():
            await asyncio.sleep(IDLE_CLOSE_SECONDS)
            async with self.lock:
                if self.mode == "run":
                    await self.close()
        self._idle = asyncio.create_task(later())

    async def close(self) -> None:
        if self._idle and self._idle is not asyncio.current_task():
            self._idle.cancel()
        self._idle = None
        if self._saver:
            self._saver.cancel()
            self._saver = None
        try:
            if self._ctx is not None:
                try:
                    await self._save_cookies()
                except Exception:
                    pass
                await self._ctx.close()
        except Exception:
            pass
        finally:
            self._ctx = self._page = None
            if self._pw is not None:
                try:
                    await self._pw.stop()
                except Exception:
                    pass
                self._pw = None
            self.headless = None
            self.recording = False
            self.mode = ""

    async def _autosave(self) -> None:
        while True:
            await asyncio.sleep(5)
            try:
                await self._save_cookies()
            except Exception:
                return      # окно закрыли

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
            self.session_file.unlink(missing_ok=True)

    # ── запись ──

    def _on_step(self, source: Any, ev: dict) -> None:
        if isinstance(ev, dict):
            ev["t"] = round(time.time() - self.started_at, 1)
            self.steps.append(ev)

    def _watch_page(self, page) -> None:
        page.on("framenavigated", lambda frame: frame == page.main_frame and self.steps.append(
            {"type": "goto", "url": frame.url, "t": round(time.time() - self.started_at, 1)}))
        page.on("response", lambda r: asyncio.create_task(self._on_response(r)))
        page.on("download", lambda d: asyncio.create_task(self._on_download(d)))

    async def _on_response(self, response) -> None:
        try:
            req = response.request
            url = response.url
            if req.resource_type not in ("xhr", "fetch", "document") or url.split("?")[0].endswith(_STATIC_EXT):
                return
            ctype = (await response.all_headers()).get("content-type", "")
            if req.resource_type == "document" and "json" not in ctype and "text/plain" not in ctype:
                return
            if len(self.responses) >= MAX_RESPONSES:
                return
            try:
                body = (await response.text())[:MAX_BODY]
            except Exception:
                return
            headers = await req.all_headers()
            self.responses.append({
                "id": len(self.responses),
                "kind": "response",
                "t": round(time.time() - self.started_at, 1),
                "method": req.method,
                "url": url,
                "status": response.status,
                "content_type": ctype,
                "request_headers": {k: v for k, v in headers.items() if not k.startswith(":")},
                "post_data": req.post_data,
                "size": len(body),
                "body": body,
                "likeness": log_likeness(body, ctype, url),
            })
        except Exception:
            pass

    async def _on_download(self, download) -> None:
        try:
            path = await download.path()
            body = Path(path).read_text(encoding="utf-8", errors="replace")[:MAX_BODY] if path else ""
        except Exception:
            body = ""
        self.responses.append({
            "id": len(self.responses),
            "kind": "download",
            "t": round(time.time() - self.started_at, 1),
            "method": "GET",
            "url": download.url,
            "filename": download.suggested_filename,
            "status": 200,
            "content_type": "text/plain",
            "request_headers": {},
            "post_data": None,
            "size": len(body),
            "body": body,
            "likeness": log_likeness(body, "text/plain", download.suggested_filename),
        })

    def snapshot(self, with_bodies: bool = False) -> dict:
        def strip(r: dict) -> dict:
            if with_bodies:
                return r
            return {**{k: v for k, v in r.items() if k != "body"}, "preview": r["body"][:600]}
        return {
            "mode": self.mode,
            "open": self.is_open,
            "seconds": round(time.time() - self.started_at, 1) if self.started_at else 0,
            "steps": self.steps,
            "responses": [strip(r) for r in self.responses],
        }

    # ── повтор ──

    async def goto(self, url: str) -> None:
        await self._page.goto(url, wait_until="domcontentloaded")

    async def fetch(self, method: str, url: str, body: Optional[str], headers: dict) -> tuple[int, str, str, str]:
        """Запрос изнутри страницы ресурса: с куками сессии, сертификатами и прокси браузера."""
        origin = _origin(url)
        if not (self._page.url or "").startswith(origin):
            await self.goto(origin + "/")
        if not (self._page.url or "").startswith(origin):
            raise NeedLogin(f"Ресурс отправил на страницу входа ({_origin(self._page.url)}) — нажмите «Войти» "
                            "в веб-коннекторе и войдите заново.")
        return await self._page.evaluate(
            """async ([method, url, body, headers]) => {
                // CSRF-заголовки берём из свежих cookie (OpenShift, Django и т.п.), а не из записи.
                const cookies = Object.fromEntries(document.cookie.split("; ").filter(Boolean)
                    .map(c => [c.split("=")[0], decodeURIComponent(c.split("=").slice(1).join("="))]));
                const h = {...headers};
                for (const k of Object.keys(h)) {
                    if (/csrf|xsrf/i.test(k) && !/^(kbn|osd)-xsrf$/i.test(k)) {
                        const c = Object.keys(cookies).find(n => /csrf|xsrf/i.test(n));
                        if (c) h[k] = cookies[c];
                    }
                }
                const r = await fetch(url, {method, credentials: "include", headers: h,
                                            body: method === "GET" || method === "HEAD" ? undefined : body});
                return [r.status, r.headers.get("content-type") || "", await r.text(), r.url];
            }""",
            [method, url, body, headers],
        )


class WindowManager:
    """Окна по коннекторам. Одно окно на коннектор в каждый момент."""

    def __init__(self):
        self._windows: dict[str, ConnectorWindow] = {}

    def get(self, connector: dict) -> ConnectorWindow:
        w = self._windows.get(connector["id"])
        if w is None:
            w = self._windows[connector["id"]] = ConnectorWindow(connector)
        w.connector = connector
        return w

    def existing(self, connector_id: str) -> Optional[ConnectorWindow]:
        return self._windows.get(connector_id)

    async def close_all(self) -> None:
        for w in self._windows.values():
            await w.close()


windows = WindowManager()
