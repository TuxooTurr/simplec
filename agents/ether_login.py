"""Explicit browser login for Efir, isolated from the user's normal browser profile."""
from __future__ import annotations
import asyncio
import os
import shutil
import threading
import time
from pathlib import Path
from agents import ether_mcp
from db import ether_credentials
from db.paths import MOCK

_lock=threading.RLock()
_state={'state':'idle','error':''}
_cancel=threading.Event()
_thread=None

def state():
    with _lock: return dict(_state)

def _set(value,error=''):
    with _lock: _state.update(state=value,error=error)

def find_browser():
    explicit=os.getenv('MCP_WEB_BROWSER_PATH','').strip()
    candidates=[explicit] if explicit else [
        '/Applications/SberBrowser.app/Contents/MacOS/SberBrowser',
        '/Applications/СберБраузер.app/Contents/MacOS/СберБраузер',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        shutil.which('sberbrowser'),shutil.which('google-chrome'),shutil.which('chromium')]
    hit=next((s for s in candidates if s and Path(s).is_file()),None)
    if not hit: raise RuntimeError('Не найден Сбербраузер или Chrome. Укажите MCP_WEB_BROWSER_PATH.')
    return hit

def cookie_header(cookies):
    return '; '.join(f"{c['name']}={c['value']}" for c in cookies
                     if c.get('domain','').lstrip('.') == 'sber.ru' or c.get('domain','').endswith('.sber.ru'))

async def _run(wait_seconds):
    if MOCK:
        if not _cancel.is_set(): _set('connected')
        return
    from playwright.async_api import async_playwright
    saved=None
    try:
        saved=ether_credentials.load()
        if saved:
            await asyncio.to_thread(ether_mcp.probe,saved)
            if not _cancel.is_set(): _set('connected')
            return
    except Exception: pass
    profile=Path(os.getenv('ETHER_BROWSER_PROFILE',str(Path.home()/'.simpletest/ether-web/profile'))).expanduser()
    profile.mkdir(parents=True,exist_ok=True)
    marker=profile/'.shark-ether-profile'
    if not marker.exists():
        if any(profile.iterdir()): raise RuntimeError('Для Эфира нужен отдельный пустой профиль браузера. Укажите ETHER_BROWSER_PROFILE.')
        marker.write_text('shark-ether', encoding='utf-8')
    os.chmod(profile,0o700)
    await asyncio.to_thread(_kill_leftovers, profile)
    context=None
    async with async_playwright() as pw:
        # This task owns one isolated profile and always closes it; never terminate unrelated browser processes.
        for attempt in range(2):
            try:
                context=await pw.chromium.launch_persistent_context(str(profile),executable_path=find_browser(),headless=False,
                    ignore_https_errors=os.getenv('ETHER_IGNORE_HTTPS_ERRORS','').lower() in ('1','true'),viewport={'width':1280,'height':860})
                break
            except Exception:
                if attempt: raise RuntimeError('Не удалось открыть браузер. Закройте прошлое окно входа Эфира и повторите.')
                await asyncio.sleep(1.5)
        try:
            if saved:
                await context.add_cookies([{'name':part.partition('=')[0].strip(),'value':part.partition('=')[2],
                                           'domain':'.sber.ru','path':'/','secure':True} for part in saved.split(';') if '=' in part])
            page=context.pages[0] if context.pages else await context.new_page()
            for _ in range(3):
                try: await page.goto('https://efir.sber.ru/',wait_until='domcontentloaded',timeout=30000); break
                except Exception as exc:
                    if 'interrupted' not in str(exc).lower() and 'navigation' not in str(exc).lower(): raise RuntimeError('Не удалось открыть Эфир. Проверьте корпоративную сеть.')
            deadline=time.monotonic()+wait_seconds;last_probe=0
            while time.monotonic()<deadline and not _cancel.is_set():
                if not context.pages: raise RuntimeError('Окно входа закрыто до подключения. Нажмите подключение ещё раз.')
                header=cookie_header(await context.cookies('https://efir.sber.ru/'))
                if header and time.monotonic()-last_probe>=4:
                    last_probe=time.monotonic()
                    try: await asyncio.to_thread(ether_mcp.probe,header)
                    except ether_mcp.EtherMcpError: pass
                    else:
                        with _lock:
                            if _cancel.is_set(): return
                            ether_credentials.save(header);ether_mcp.reset_caches();_set('connected')
                        return
                await asyncio.sleep(1)
            if not _cancel.is_set(): _set('timeout','За 5 минут вход не завершён. Повторите подключение.')
        finally: await context.close()

def start(wait_seconds=300):
    global _thread
    with _lock:
        if _thread and _thread.is_alive(): return state()
        _cancel.clear();_set('waiting')
        def run():
            try: asyncio.run(_run(wait_seconds))
            except Exception as exc:
                if not _cancel.is_set():
                    text=str(exc) if isinstance(exc,RuntimeError) else 'Не удалось подключить Эфир. Проверьте браузер и корпоративную сеть.'
                    _set('error',text)
        _thread=threading.Thread(target=run,daemon=True);_thread.start()
        return state()

def cancel():
    with _lock:
        _cancel.set();ether_credentials.clear();_set('idle')
    ether_mcp.reset_caches()

async def shutdown():
    _cancel.set()
    if _thread and _thread.is_alive(): await asyncio.to_thread(_thread.join,35)


def _kill_leftovers(profile):
    """Recover only a browser started with our exact, isolated user-data-dir."""
    import shlex
    import signal
    import subprocess
    if not (Path(profile)/'.shark-ether-profile').is_file(): return
    expected = '--user-data-dir=' + str(Path(profile).expanduser().resolve())
    try:
        listing = subprocess.run(['ps','-axo','pid=,args='],capture_output=True,text=True,check=True).stdout
    except (OSError, subprocess.SubprocessError): return
    for line in listing.splitlines():
        pid, _, args = line.strip().partition(' ')
        try: parts = shlex.split(args.strip())
        except ValueError: continue
        if expected not in parts: continue
        executable = args.strip().split(' --', 1)[0].strip(chr(34))
        if not parts or not any(name in Path(executable).name.lower() for name in ('sber','chrome','chromium')): continue
        try: os.kill(int(pid),signal.SIGTERM)
        except (ProcessLookupError,PermissionError,ValueError): pass
