#!/usr/bin/env python3
"""Offline readiness checks; explicit read-only MCP probes. Never print credentials or source records."""
from __future__ import annotations
import argparse
import asyncio
import importlib.util
import importlib.metadata
import re
import ssl
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
REQUIRED = ('fastapi', 'uvicorn', 'dotenv', 'mcp', 'httpx2', 'playwright', 'cryptography', 'sqlalchemy')


def check(items, name, status, message):
    items.append({'check': name, 'status': status, 'message': message})


def initialize_env(target: Path):
    """Exclusive creation; keep existing corporate settings untouched."""
    target = target.expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        stream.write((ROOT / 'config/corporate.env.example').read_text(encoding='utf-8'))


def load_environment(path, items):
    try:
        from dotenv import load_dotenv
    except ImportError:
        check(items, 'environment', 'missing', 'Активируйте окружение Shark и установите requirements.txt.')
        return
    load_dotenv(ROOT / '.env')
    selected = path or os.getenv('SHARK_ENV_FILE', '')
    if selected:
        if not Path(selected).expanduser().is_file():
            check(items, 'environment', 'missing', 'Файл SHARK_ENV_FILE/--env-file не найден.')
            return
        load_dotenv(Path(selected).expanduser(), override=True)
        check(items, 'environment', 'pass', 'Дополнение контура загружено; значения настроек скрыты.')
    else:
        check(items, 'environment', 'manual', 'Внешний файл контура не выбран. Используйте --env-file или SHARK_ENV_FILE.')


def file_check(items, variable, *, executable=False):
    value = os.getenv(variable, '').strip()
    exists = bool(value) and Path(value).expanduser().is_file()
    valid = exists and (not executable or os.access(Path(value).expanduser(), os.X_OK))
    check(items, variable, 'pass' if valid else 'missing',
          'Файл доступен.' if valid else 'Укажите доступный файл в этой переменной; содержимое не выводится.')


def encrypted_store_present(filename, field):
    data_dir = Path(os.getenv('SHARK_DATA_DIR') or ROOT / 'data').expanduser()
    try:
        value = json.loads((data_dir / filename).read_text(encoding='utf-8'))
        return isinstance(value, dict) and bool(value.get(field))
    except (OSError, ValueError): return False


def offline_checks(*, software_only=False):
    items = []
    version = sys.version_info
    supported = version.major == 3 and 10 <= version.minor <= 12
    check(items, 'python', 'pass' if supported else 'missing',
          'Python 3.10–3.12.' if supported else 'Для бэкенда нужен Python 3.10–3.12; MCP имеет отдельное окружение.')
    for module in REQUIRED:
        try: present = importlib.util.find_spec(module) is not None
        except (ImportError, ValueError): present = False
        check(items, 'module:' + module, 'pass' if present else 'missing',
              'Модуль доступен.' if present else 'Установите зависимости из requirements.txt в выбранное окружение.')
    try:
        sdk = importlib.metadata.version('mcp')
        parts = tuple(int(x) for x in re.findall(r'\d+', sdk)[:2])
        sdk_ok = (2, 3) <= parts < (3, 0)
    except (importlib.metadata.PackageNotFoundError, ValueError): sdk_ok = False
    check(items, 'mcp_sdk', 'pass' if sdk_ok else 'missing', 'SDK MCP v2.3+ доступен.' if sdk_ok else 'Обновите MCP по requirements.txt (>=2.3,<3).')
    node = shutil.which('node')
    try:
        result = subprocess.run([node, '--version'], capture_output=True, text=True, timeout=5, check=True) if node else None
        major = int(result.stdout.strip().lstrip('v').split('.')[0]) if result else 0
    except (OSError, subprocess.SubprocessError, ValueError): major = 0
    check(items, 'node', 'pass' if major >= 20 else 'missing', 'Node.js 20+ доступен.' if major >= 20 else 'Установите Node.js 20+ из разрешённого источника.')
    if major >= 20:
        from agents.plantuml_render import render_markdown
        _, diagram_errors = render_markdown("@startuml\ncomponent A\ncomponent B\nA --> B\n@enduml",
                                            lambda _: "/health/diagram.svg")
        check(items, 'plantuml', 'missing' if diagram_errors else 'pass',
              'Схема не построилась. Проверьте наличие vendor/plantuml в дистрибутиве Shark.' if diagram_errors
              else 'Встроенный PlantUML построил схему без сети.')
    check(items, 'frontend_dependencies', 'pass' if (ROOT / 'frontend/node_modules/next/package.json').is_file() else 'missing',
          'Проверьте npm ci --prefix frontend по package-lock.json.')
    if software_only: return items
    demo = os.getenv('SHARK_MOCK', '').lower() in ('1', 'true', 'yes', 'on')
    check(items, 'real_mode', 'missing' if demo else 'pass',
          'Включён SHARK_MOCK: корпоративная приёмка невозможна.' if demo else 'Мок-режим выключен; это не проверка доступности сети.')
    profile = os.getenv('LOGS_MCP_PROFILE', '').strip().lower()
    transport = os.getenv('LOGS_MCP_TRANSPORT', '').strip().lower()
    check(items, 'pvs_profile', 'pass' if profile == 'pvs' and transport == 'stdio' else 'missing', 'Для корпоративного PVS нужны LOGS_MCP_PROFILE=pvs и LOGS_MCP_TRANSPORT=stdio.')
    file_check(items, 'LOGS_MCP_COMMAND', executable=True)
    for name in ('OPENSEARCH_URL', 'LOGS_PVS_INDEX', 'LOGS_MCP_NAMESPACE'):
        check(items, name, 'pass' if os.getenv(name, '').strip() else 'missing', 'Значение задано.' if os.getenv(name, '').strip() else 'Задайте по инструкции контура.')
    try:
        parsed = urlsplit(os.getenv('OPENSEARCH_URL', ''))
        wrong = parsed.scheme != 'https' or not parsed.hostname or bool(parsed.username or parsed.password) or parsed.port == 15601 or '00076.' in (parsed.hostname or '')
    except ValueError: wrong = True
    if wrong: check(items, 'pvs_api_host', 'missing', 'Указан веб-интерфейс/некорректный порт. Для ИФТ API — хост 00075:19200.')
    try:
        fields = json.loads(os.getenv('LOGS_PVS_FIELDS', '{}'))
        valid = isinstance(fields, dict) and all(isinstance(fields.get(k), str) and fields[k].strip() for k in ('namespace', 'service', 'timestamp', 'level'))
    except (ValueError, TypeError): valid = False
    check(items, 'LOGS_PVS_FIELDS', 'pass' if valid else 'missing', 'Карта содержит обязательные поля; фактический mapping сверяется на ИФТ.' if valid else 'Заполните JSON-карту полей из config/corporate.env.example и сверьте с mapping.')
    for name in ('OPENSEARCH_CA_CERT_PATH', 'OPENSEARCH_CLIENT_CERT_PATH', 'OPENSEARCH_CLIENT_KEY_PATH'): file_check(items, name)
    verify = os.getenv('OPENSEARCH_SSL_VERIFY', 'true').lower() in ('1', 'true', 'yes', 'on')
    check(items, 'pvs_tls_verify', 'pass' if verify else 'missing', 'Проверка TLS включена.' if verify else 'Подключите корпоративный CA и включите OPENSEARCH_SSL_VERIFY.')
    tls_files = [os.getenv(name, '') for name in ('OPENSEARCH_CA_CERT_PATH', 'OPENSEARCH_CLIENT_CERT_PATH', 'OPENSEARCH_CLIENT_KEY_PATH')]
    if all(value and Path(value).expanduser().is_file() for value in tls_files):
        try:
            context = ssl.create_default_context(cafile=str(Path(tls_files[0]).expanduser()))
            context.load_cert_chain(str(Path(tls_files[1]).expanduser()), str(Path(tls_files[2]).expanduser()), password=lambda: '')
            check(items, 'pvs_certificate_pair', 'pass', 'CA разобран, клиентский сертификат соответствует ключу; сеть не проверялась.')
        except (OSError, ValueError):
            check(items, 'pvs_certificate_pair', 'missing', 'Не удалось прочитать CA/пару сертификат–ключ. Проверьте PEM-формат, цепочку и защиту ключа на хосте.')
    pvs_auth = bool(os.getenv('OPENSEARCH_USERNAME') and os.getenv('OPENSEARCH_PASSWORD')) or encrypted_store_present('pvs_credentials.json', 'password_enc')
    check(items, 'pvs_auth', 'pass' if pvs_auth else 'missing', 'Учётка задана; расшифровка и права проверяются при подключении.' if pvs_auth else 'Сохраните учётку через Настройки → Подключения → PVS MCP или передайте секрет окружения.')
    ether_auth = bool(os.getenv('ETHER_MCP_HEADERS', '').strip()) or encrypted_store_present('ether_cookies.json', 'cookie_enc')
    check(items, 'ether_auth', 'pass' if ether_auth else 'manual', 'Авторизация задана; требуется живая проверка.' if ether_auth else 'Войдите через кнопку Эфира в браузере. На сервере без GUI используйте секрет ETHER_MCP_HEADERS.')
    explicit = os.getenv('MCP_WEB_BROWSER_PATH', '').strip()
    candidates = [explicit] if explicit else ['/Applications/SberBrowser.app/Contents/MacOS/SberBrowser', '/Applications/СберБраузер.app/Contents/MacOS/СберБраузер', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', shutil.which('sberbrowser'), shutil.which('google-chrome'), shutil.which('chromium')]
    browser = any(path and Path(path).is_file() and os.access(path, os.X_OK) for path in candidates)
    check(items, 'ether_browser', 'pass' if browser or ether_auth else 'missing', 'Браузер найден либо задана серверная авторизация.' if browser or ether_auth else 'Установите Сбербраузер/Chrome или задайте MCP_WEB_BROWSER_PATH.')
    check(items, 'jira_confluence', 'manual', 'В UI проверьте подключение Jira, Confluence, права и реальный JQL; параметры страниц стендов уже поддерживаются.')
    check(items, 'gigacode_mcp', 'manual', 'Зарегистрируйте PVS/Эфир в ГигаКод по корпоративной документации. Настройки ГигаКод скрипт не изменяет.')
    return items


def sanitized_schema(value, property_map=False):
    """Preserve parameter names, but omit free text and literal/example values."""
    hidden = {'description', 'default', 'example', 'examples', 'title', 'enum', 'const'}
    if isinstance(value, dict):
        return {k: sanitized_schema(v, k in ('properties', '$defs', 'definitions', 'patternProperties'))
                for k, v in value.items() if property_map or k not in hidden}
    if isinstance(value, list): return [sanitized_schema(v) for v in value]
    return value


async def export_contract(client, target):
    tools = []; cursor = None
    for _ in range(10):
        page = await client.list_tools(cursor=cursor) if cursor else await client.list_tools()
        tools.extend({'name': t.name, 'input_schema': sanitized_schema(t.input_schema),
                      'read_only': getattr(t.annotations, 'read_only_hint', None) if t.annotations else None} for t in page.tools)
        cursor = getattr(page, 'next_cursor', None)
        if not cursor: break
    target.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream: json.dump({'tools': tools, 'truncated': bool(cursor)}, stream, ensure_ascii=False, indent=2)


async def probe(service, items, *, timeout=30, contracts=None):
    # Never label mocks as verified corporate access.
    if os.getenv('SHARK_MOCK', '').lower() in ('1', 'true', 'yes', 'on'):
        check(items, service + '_live', 'missing', 'Отключите SHARK_MOCK для живой проверки; демо не засчитывается.')
        return
    if service == 'pvs' and os.getenv('LOGS_MCP_PROFILE', '').lower() != 'pvs':
        check(items, 'pvs_live', 'missing', 'Нужен профиль LOGS_MCP_PROFILE=pvs; другой источник не засчитывается.')
        return
    import anyio
    try:
        with anyio.fail_after(timeout):
            if service == 'pvs':
                from agents.logs_mcp import open_source
                from agents.log_assertions import read_matching, LogFilter
                async with open_source() as source:
                    if contracts: await export_contract(source.client, contracts / 'pvs-tools.json')
                    now = datetime.now(timezone.utc)
                    result = await read_matching(source, now-timedelta(minutes=15), now, LogFilter(), 1)
                    check(items, 'pvs_live', 'pass', 'MCP ответил на ограниченный запрос чтения; содержимое логов не выводится.')
                    check(items, 'pvs_sample', 'pass' if result.records else 'manual', 'Запись распознана; вручную сверьте её в веб-интерфейсе.' if result.records else 'За 15 минут нет записей. Для приёмки повторите на известной операции.')
            else:
                from agents import ether_mcp
                async with ether_mcp.open_client() as client:
                    if contracts: await export_contract(client, contracts / 'ether-tools.json')
                    await ether_mcp._call(client, 'chat_get_spaces', {'limit': 1, 'count': 1, 'offset': 0})
                    check(items, 'ether_live', 'pass', 'MCP принял авторизацию и запрос чтения; сообщения не выгружаются.')
                    check(items, 'ether_feed', 'manual', 'В UI выберите коллег и сверьте ленту с Эфиром.')
    except Exception as exc:
        check(items, service + '_live', 'missing', 'Подключение не подтверждено (' + type(exc).__name__ + '). Проверьте доступ, сертификаты, сессию и tools/list. Ответ источника скрыт.')


@contextmanager
def silence_source_output():
    """CLI-only: SDK/child diagnostics must not echo remote data or credentials."""
    saved = []
    try:
        with open(os.devnull, 'w') as sink:
            sys.stdout.flush(); sys.stderr.flush()
            for fd in (1, 2):
                saved.append((fd, os.dup(fd)))
                os.dup2(sink.fileno(), fd)
            yield
    finally:
        sys.stdout.flush(); sys.stderr.flush()
        for fd, original in saved:
            os.dup2(original, fd)
            os.close(original)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--init-env', type=Path, help='Создать закрытый шаблон; существующий файл не перезаписывается.')
    parser.add_argument('--env-file', type=Path, help='Дополнение настроек контура; значения не печатаются.')
    parser.add_argument('--software-only', action='store_true', help='Только Python/Node/зависимости, без готовности контура.')
    parser.add_argument('--probe', choices=('pvs', 'ether', 'all'), help='Явные живые read-only проверки MCP.')
    parser.add_argument('--timeout', type=int, default=30)
    parser.add_argument('--contracts-dir', type=Path, help='Сохранить только контракты tools/list в закрытые новые файлы.')
    parser.add_argument('--report', type=Path, help='JSON-отчёт без секретов/логов/переписки.')
    args = parser.parse_args(argv)
    if args.contracts_dir and not args.probe: parser.error('--contracts-dir требует явного --probe')
    if args.probe and args.software_only: parser.error('--software-only несовместим с --probe')
    if not 5 <= args.timeout <= 600: parser.error('--timeout должен быть 5–600 секунд')
    if args.init_env:
        try: initialize_env(args.init_env)
        except FileExistsError: print('Шаблон уже существует; настройки не изменены.'); return 2
        print('Создан шаблон с правами 0600. Секретов в нём нет.'); return 0
    checks = []
    load_environment(args.env_file, checks)
    checks.extend(offline_checks(software_only=args.software_only))
    if args.probe:
        for service in (('pvs', 'ether') if args.probe == 'all' else (args.probe,)):
            with silence_source_output():
                asyncio.run(probe(service, checks, timeout=args.timeout, contracts=args.contracts_dir))
    payload = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'mode': 'live' if args.probe else 'offline',
               'checks': checks, 'automaticChecksPassed': not any(c['status'] == 'missing' for c in checks),
               'manualActionsRemain': any(c['status'] == 'manual' for c in checks), 'corporateAcceptanceComplete': False, 'note': 'Офлайн-успех не подтверждает корпоративный доступ; manual требует действий на хосте.'}
    for item in checks: print(f"[{item['status']}] {item['check']}: {item['message']}")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.chmod(args.report, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream: json.dump(payload, stream, ensure_ascii=False, indent=2)
    return 2 if any(c['status'] == 'missing' for c in checks) else 0

if __name__ == '__main__': raise SystemExit(main())
