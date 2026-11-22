"""Efir feed (read) plus explicit user actions (reply in chat / mail); process caches and a rolling account budget.

Инструменты MCP берутся только из реального tools/list: известные имена или точное имя из переменной окружения.
Чтение — инструменты с readOnlyHint=true. Запись (ответ в чат, ответ на письмо) — только по нажатию пользователя
«Отправить», инструмент не должен объявлять destructiveHint=true. Нет инструмента — честная недоступность."""
from __future__ import annotations
import json
import os
import threading
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
import anyio
from db import ether_credentials
from db.paths import MOCK
from webconnect.secrets import SecretError

class EtherMcpError(Exception): pass
_LOCK = threading.RLock()
_dialogs = (0, [])
_messages = {}
_budget = deque()
_dialog_budget = deque()
_auth_generation = 0
_feed_cache = {}
_cycle_calls = 0
_channels = {}

class EtherChannelUnavailable(EtherMcpError): pass

def setting(name, default, low=1, high=3600):
    try: return max(low, min(high, int(os.getenv(name, str(default)))))
    except ValueError: return default

def reset_caches():
    global _dialogs, _auth_generation, _cycle_calls
    with _LOCK:
        _dialogs = (0, []); _cycle_calls = 0; _messages.clear(); _channels.clear(); _feed_cache.clear(); _budget.clear(); _dialog_budget.clear(); _auth_generation += 1

def credential_source():
    try:
        if ether_credentials.load(): return 'cookie'
    except SecretError: return 'broken'
    return 'env' if os.getenv('ETHER_MCP_HEADERS', '').strip() else 'none'

def configured(): return credential_source() != 'none' or MOCK

def auth_headers():
    try: cookie = ether_credentials.load()
    except SecretError as exc: raise EtherMcpError('Хранилище сессии Эфира недоступно. Подключитесь заново.') from exc
    if cookie: return {'Cookie': cookie}
    headers = {}
    for line in os.getenv('ETHER_MCP_HEADERS', '').splitlines():
        name, sep, value = line.partition(':')
        if not sep or not name.strip() or '\r' in value or '\n' in value: raise EtherMcpError('Проверьте формат ETHER_MCP_HEADERS: имя: значение.')
        headers[name.strip()] = value.strip()
    return headers

@asynccontextmanager
async def open_client(extra_headers=None):
    import httpx2
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client
    url = os.getenv('ETHER_MCP_URL', 'https://efir.sber.ru/api/platform/api/v1/mcp/mcp/')
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise EtherMcpError('Адрес MCP Эфира должен быть HTTPS без встроенных учётных данных.')
    timeout = setting('ETHER_REQUEST_TIMEOUT', 30, high=120)
    headers = {**({} if extra_headers is not None else auth_headers()), **(extra_headers or {})}
    try:
        async with httpx2.AsyncClient(headers=headers, timeout=timeout, follow_redirects=False) as http:
            async with Client(streamable_http_client(url, http_client=http), read_timeout_seconds=timeout) as client:
                yield client
    except EtherMcpError: raise
    except Exception as exc: raise EtherMcpError('Эфир не ответил или сессия истекла. Подключитесь через браузер повторно.') from exc

async def _call(client, name, args):
    # Resolve read tools against the advertised schema instead of assuming all optional argument names.
    wanted = name.removeprefix('chat_')
    cursor = None
    tool = None
    for _ in range(10):
        listing = await client.list_tools(cursor=cursor) if cursor else await client.list_tools()
        tool = next((t for t in listing.tools if t.name in (name, wanted)), None)
        cursor = getattr(listing, 'next_cursor', None)
        if tool or not cursor: break
    if tool is None: raise EtherMcpError('MCP Эфира не объявил необходимый инструмент чтения.')
    return await _execute(client, tool, args)

async def _execute(client, tool, args, write=False):
    if not write and tool.annotations and tool.annotations.read_only_hint is False: raise EtherMcpError('Инструмент Эфира не объявлен для чтения.')
    props = tool.input_schema.get('properties', {})
    values = {k:v for k,v in args.items() if k in props}
    if set(tool.input_schema.get('required', [])) - values.keys(): raise EtherMcpError('Изменился контракт MCP Эфира. Проверьте параметры инструмента.')
    result = await client.call_tool(tool.name, values)
    if result.is_error: raise EtherMcpError('Эфир отклонил запрос. Проверьте сессию и права чтения.')
    if result.structured_content is not None: return result.structured_content
    try: return json.loads('\n'.join(b.text for b in result.content if b.type == 'text'))
    except (ValueError, TypeError):
        if write: return {}          # запись прошла (is_error=False), ответ — просто текст подтверждения
        raise EtherMcpError('Не распознан ответ MCP Эфира.')

def _items(data, *keys):
    if isinstance(data, list): return data
    if isinstance(data, dict):
        for key in keys:
            if isinstance(data.get(key), list): return data[key]
        if isinstance(data.get('data'), (dict,list)): return _items(data['data'], *keys)
    return []

def as_time(value):
    try:
        if isinstance(value, (float,int)): return datetime.fromtimestamp(value/1000 if value>1e12 else value, timezone.utc)
        stamp = datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError): return None

def match_author(author, filters):
    a = ' '.join(str(author).lower().split())
    for text in filters:
        f = ' '.join(text.lower().split())
        if f and (a == f or (len(f)>=3 and len(a)>=3 and (f in a or a in f))): return True
    return False

def matches_tracking(people, text, users, keywords):
    return any(match_author(person, users) for person in people) or any(word.casefold() in text.casefold() for word in keywords if word.strip())

def message_text(message):
    if message.get('confidential_hidden'): return '[конфиденциальное сообщение скрыто]'
    text = str(message.get('text') or '')
    document = message.get('document')
    if isinstance(document, dict): text += '\n📎 ' + str(document.get('file_name') or 'Вложение') + '\n' + str(document.get('text') or '')
    return text.strip()[:12000]

def _available(budget, limit):
    now = time.monotonic()
    while budget and now-budget[0] >= 60: budget.popleft()
    if len(budget)>=limit: return False
    budget.append(now); return True

def dialog_time(dialog):
    value = dialog.get('last_message_date') or dialog.get('last_activity') or dialog.get('last_message')
    if isinstance(value, dict): value = value.get('date') or value.get('created_at') or value.get('timestamp')
    return as_time(value) or datetime.min.replace(tzinfo=timezone.utc)

async def _fetch_async(filters, keywords=()):
    global _dialogs, _cycle_calls
    now = time.monotonic()
    # All account calls are serialized by fetch_feed, including overlapping HTTP requests.
    async with open_client() as client:
        if now-_dialogs[0] >= setting('ETHER_DIALOGS_TTL',60):
            if _available(_dialog_budget,10):
                raw = await _call(client,'chat_get_dialogs',{'scope':'active','limit':200,'count':200,'offset':0})
                _dialogs = (now, _items(raw,'dialogs','items','results')); _cycle_calls = 0
        dialogs = sorted(_dialogs[1], key=dialog_time, reverse=True)[:25]
        # Missing/oldest caches first: a small account budget must not starve later dialogs.
        dialogs.sort(key=lambda dialog: _messages.get(json.dumps(dialog.get('peer', dialog.get('conversation_peer')), sort_keys=True, ensure_ascii=False), (0, []))[0])
        result=[]; oldest=datetime.now(timezone.utc)-timedelta(hours=setting('ETHER_FEED_LOOKBACK_HOURS',72,high=720))
        for dialog in dialogs:
            peer=dialog.get('peer',dialog.get('conversation_peer'))
            if peer is None: continue
            cache_key=json.dumps(peer,sort_keys=True,ensure_ascii=False)
            cached=_messages.get(cache_key)
            if not cached or now-cached[0]>=setting('ETHER_MSG_TTL',90):
                if _cycle_calls<setting('ETHER_BUDGET',8,high=20) and _available(_budget,20):
                    _cycle_calls += 1
                    raw=await _call(client,'chat_get_messages',{'peer':peer,'limit':30,'count':30,'offset':0})
                    cached=(time.monotonic(),_items(raw,'messages','items','results'));_messages[cache_key]=cached
            for message in cached[1] if cached else []:
                sender=message.get('sender') or {}; sender=sender if isinstance(sender,dict) else {'name':str(sender)}
                author=str(sender.get('name') or sender.get('display_name') or message.get('sender_name') or '')
                login=str(sender.get('login') or sender.get('peer') or '')
                at=as_time(message.get('date') or message.get('created_at'))
                text=message_text(message)
                dialog_name = str(dialog.get('name') or dialog.get('title') or '')
                # Отслеживаемый «участник» — человек, чат или группа: совпадение с автором или с названием диалога.
                if not text or not at or at<oldest or not matches_tracking([author, login, dialog_name], text + ' ' + dialog_name, filters, keywords): continue
                identifier=str(message.get('mid') or message.get('id') or at.isoformat())
                result.append({'id':cache_key+':'+identifier,'author':author or login,'text':text,'date':at.isoformat(),
                               'dialog':dialog_name,'peer':peer})
        unique={m['id']:m for m in result}
        return sorted(unique.values(),key=lambda m:m['date'])[-setting('ETHER_FEED_LIMIT',100,high=1000):]

def fetch_feed(users, keywords=()):
    filters=[s.strip() for s in users if s.strip()]
    keywords=[s.strip() for s in keywords if s.strip()]
    if not filters and not keywords: return []
    if MOCK:
        return _demo_feed('chat', filters, keywords)
    key=('chat', tuple(filters), tuple(keywords))
    if not _LOCK.acquire(blocking=False):
        if key in _feed_cache: return _feed_cache[key]
        raise EtherMcpError('Лента Эфира обновляется. Повторите через несколько секунд.')
    try:
        async def bounded():
            with anyio.fail_after(55): return await _fetch_async(filters, keywords)
        result=anyio.run(bounded);_feed_cache[key]=result;return result
    except TimeoutError as exc: raise EtherMcpError('Эфир отвечает слишком долго. Сохранена последняя лента; повторите обновление.') from exc
    finally: _LOCK.release()

def _demo_feed(channel, users, keywords, everything=False):
    now = datetime.now(timezone.utc)
    author = users[0] if users else 'Анна Смирнова'
    samples = {
        'chat': [
            ('qa-release', author, 'Команда QA', 'Релиз 2.11 · ИФТ', 'Проверка релиза на ИФТ завершена. Осталась одна ошибка в интеграции — приложила trace ID.'),
            ('backend', 'Михаил Орлов', 'Backend · Интеграции', 'Ошибка на ИФТ', 'Нашёл причину таймаута в notification-service. Исправление уже на проверке.'),
            ('daily', author, 'Команда QA', 'План на сегодня', 'На регресс отвели два часа. После проверки обновим задачи и график стендов.'),
            ('release', 'Елена Волкова', 'Релизная группа', 'Готовность ПСИ', 'Коллеги, подтвердите готовность к релизу на ПСИ до 16:00.'),
        ],
        'mail': [
            ('mail-release', author, 'Входящие', 'Релиз · результаты регресса', 'Регресс на ИФТ завершён. В письме — сводка проверок и открытых замечаний.'),
            ('mail-incident', 'Михаил Орлов', 'Входящие', 'Ошибка интеграции · нужен повторный тест', 'Исправление установлено. Просьба повторить сценарий уведомления и приложить результат к задаче.'),
            ('mail-psi', 'Елена Волкова', 'Входящие', 'Согласование окна ПСИ', 'Предлагаем начать установку в 15:00. Подтвердите состав микросервисов.'),
        ],
        'meetings': [
            ('meeting-daily', author, 'Команда QA', 'QA · планирование релиза', 'План регресса, риски и распределение задач.'),
            ('meeting-incident', 'Михаил Орлов', 'Backend · Интеграции', 'Разбор ошибки интеграции', 'Проверим trace ID и согласуем повторное тестирование.'),
            ('meeting-psi', 'Елена Волкова', 'Релизная группа', 'Готовность к ПСИ', 'Согласование окна установки и итогового состава релиза.'),
        ],
    }
    result = []
    for i, (identifier, person, dialog, title, text) in enumerate(samples[channel]):
        if not everything and not matches_tracking([person, dialog], title + ' ' + text + ' ' + dialog, users, keywords): continue
        at = now + timedelta(hours=i + 1) if channel == 'meetings' else now - timedelta(minutes=i * 17 + 3)
        item = {'id': 'demo-' + identifier, 'author': person, 'dialog': dialog, 'title': title, 'text': text, 'date': at.isoformat()}
        if channel == 'chat': item['peer'] = {'demo': identifier}
        if channel == 'mail': item['sourceId'] = 'demo-' + identifier
        if channel == 'meetings': item.update(endDate=(at + timedelta(minutes=30)).isoformat(), location='Эфир · видеовстреча')
        result.append(item)
    return result

async def _channel_tool(client, channel):
    explicit = os.getenv('ETHER_' + channel.upper() + '_TOOL', '').strip()
    candidates = {
        'mail': {'mail_get_messages', 'mail_list_messages', 'get_emails', 'list_emails', 'get_mail', 'list_mail'},
        'meetings': {'calendar_get_events', 'calendar_list_events', 'get_meetings', 'list_meetings', 'get_events', 'list_events'},
    }[channel]
    cursor = None
    found = []
    for _ in range(10):
        listing = await client.list_tools(cursor=cursor) if cursor else await client.list_tools()
        for tool in listing.tools:
            readonly = tool.annotations and tool.annotations.read_only_hint is True
            if (explicit and tool.name == explicit or not explicit and tool.name in candidates) and readonly:
                found.append(tool)
        cursor = getattr(listing, 'next_cursor', None)
        if not cursor: break
    if len(found) != 1:
        raise EtherChannelUnavailable('В текущем подключении Эфира не подтверждено чтение ' + ('почты.' if channel == 'mail' else 'встреч.'))
    return found[0]

def _person(value):
    if isinstance(value, dict): return str(value.get('display_name') or value.get('name') or value.get('email') or value.get('login') or '')
    return str(value or '')

def _identities(value):
    if isinstance(value, dict):
        return [str(value[k]) for k in ('name', 'display_name', 'email', 'login', 'peer') if value.get(k)]
    return [str(value)] if value else []

def _normalize_channel(channel, raw):
    rows = _items(raw, 'messages', 'emails', 'mail', 'events', 'meetings', 'items', 'results')
    result = []
    now = datetime.now(timezone.utc)
    oldest = now - timedelta(hours=setting('ETHER_FEED_LOOKBACK_HOURS', 72, high=720))
    for row in rows:
        if not isinstance(row, dict): continue
        date = as_time(row.get('start') or row.get('start_time') or row.get('date') or row.get('received_at') or row.get('created_at'))
        if not date or date < oldest: continue
        if channel == 'mail' and date > now: continue
        if channel == 'meetings' and date > now + timedelta(hours=setting('ETHER_FEED_LOOKBACK_HOURS', 72, high=720)): continue
        person = row.get('organizer') if channel == 'meetings' else row.get('sender') or row.get('from')
        author = _person(person)
        title = str(row.get('subject') or row.get('title') or row.get('name') or '')[:1000]
        text = row.get('text') or row.get('body') or row.get('description') or row.get('preview') or ''
        if isinstance(text, dict): text = text.get('text') or text.get('content') or ''
        if row.get('confidential_hidden'): title, text = 'Конфиденциальная запись', '[содержимое скрыто]'
        attendees = row.get('attendees') or row.get('recipients') or []
        if not isinstance(attendees, list): attendees = [attendees]
        people = [author, *_identities(person), *[identity for p in attendees for identity in _identities(p)]]
        identifier = row.get('id') or row.get('mid') or row.get('uid')
        if identifier is None:
            import hashlib
            identifier = hashlib.sha256((date.isoformat() + author + title + str(text)).encode()).hexdigest()[:24]
        item = {'id': channel + ':' + str(identifier), 'sourceId': str(identifier), 'author': author, 'title': title, 'text': str(text)[:12000],
                'date': date.isoformat(), 'dialog': str(row.get('folder') or row.get('calendar') or ''), '_people': people}
        end = as_time(row.get('end') or row.get('end_time'))
        if end: item['endDate'] = end.isoformat()
        if channel == 'meetings': item['location'] = str(row.get('location') or '')[:1000]
        result.append(item)
    return result

async def _fetch_channel_async(channel):
    async with open_client() as client:
        tool = await _channel_tool(client, channel)
        now = datetime.now(timezone.utc)
        hours = setting('ETHER_FEED_LOOKBACK_HOURS', 72, high=720)
        args = {'limit': setting('ETHER_FEED_LIMIT', 100, high=1000), 'count': 100, 'offset': 0,
                'start': (now - timedelta(hours=hours)).isoformat(), 'end': (now + timedelta(hours=hours) if channel == 'meetings' else now).isoformat()}
        try:
            extra = json.loads(os.getenv('ETHER_' + channel.upper() + '_ARGS', '{}'))
            if not isinstance(extra, dict): raise ValueError
        except (ValueError, TypeError): raise EtherMcpError('Проверьте параметры чтения выбранного канала Эфира.')
        args.update(extra)
        if not _available(_budget, 20): raise EtherMcpError('Достигнут бюджет чтения Эфира. Повторите через минуту.')
        raw = await _execute(client, tool, args)
        return _normalize_channel(channel, raw)

def fetch_channel(channel, users, keywords):
    users = [s.strip() for s in users if s.strip()]
    keywords = [s.strip() for s in keywords if s.strip()]
    # Встречи без настроенного отслеживания — все встречи окна; чат и почта без фильтра пусты (иначе — вся переписка).
    everything = channel == 'meetings' and not users and not keywords
    if not users and not keywords and not everything: return {'available': True, 'messages': []}
    if MOCK: return {'available': True, 'demo': True, 'messages': _demo_feed(channel, users, keywords, everything)}
    if channel == 'chat': return {'available': True, 'messages': list(reversed(fetch_feed(users, keywords)))}
    if not _LOCK.acquire(blocking=False): raise EtherMcpError('Эфир обновляется. Повторите через несколько секунд.')
    try:
        cached = _channels.get(channel)
        if cached is None or time.monotonic() - cached[0] >= setting('ETHER_MSG_TTL', 90):
            async def bounded():
                with anyio.fail_after(55): return await _fetch_channel_async(channel)
            cached = (time.monotonic(), anyio.run(bounded))
            _channels[channel] = cached
        result = []
        for item in cached[1]:
            if everything or matches_tracking(item['_people'], item['title'] + ' ' + item['text'], users, keywords):
                result.append({k: v for k, v in item.items() if k != '_people'})
        result.sort(key=lambda item: item['date'], reverse=channel != 'meetings')
        return {'available': True, 'messages': result[:setting('ETHER_FEED_LIMIT', 100, high=1000)]}
    except EtherChannelUnavailable as exc: return {'available': False, 'messages': [], 'reason': str(exc)}
    except TimeoutError as exc: raise EtherMcpError('Эфир отвечает слишком долго. Повторите обновление.') from exc
    finally: _LOCK.release()

def probe(cookie_header):
    if MOCK: return
    async def run():
        async with open_client({'Cookie':cookie_header}) as client: await _call(client,'chat_get_spaces',{'limit':1,'count':1,'offset':0})
    with _LOCK: anyio.run(run)


# ── Поиск участников, переписка и ответы ─────────────────────────────────────

TOOL_KINDS = {
    'search': {'env': 'ETHER_SEARCH_TOOL', 'write': False, 'missing': 'Поиск коллег в текущем подключении Эфира не подтверждён.',
               'names': {'chat_search_users', 'search_users', 'find_users', 'chat_find_users', 'search_contacts', 'chat_search_contacts',
                         'users_search', 'chat_search_peers', 'search_peers'}},
    'send': {'env': 'ETHER_SEND_TOOL', 'write': True, 'missing': 'Отправка сообщений в текущем подключении Эфира не подтверждена.',
             'names': {'chat_send_message', 'send_message', 'chat_send', 'messages_send'}},
    'mail_read': {'env': 'ETHER_MAIL_READ_TOOL', 'write': False, 'missing': 'Чтение письма целиком в текущем подключении Эфира не подтверждено.',
                  'names': {'mail_get_message', 'get_email', 'mail_read_message', 'get_mail_message', 'read_email'}},
    'mail_reply': {'env': 'ETHER_MAIL_REPLY_TOOL', 'write': True, 'missing': 'Ответ на письмо в текущем подключении Эфира не подтверждён.',
                   'names': {'mail_reply', 'reply_email', 'mail_send_reply', 'reply_to_email', 'mail_reply_message'}},
}


async def _tool_of(client, kind):
    spec = TOOL_KINDS[kind]
    explicit = os.getenv(spec['env'], '').strip()
    found, cursor = [], None
    for _ in range(10):
        listing = await client.list_tools(cursor=cursor) if cursor else await client.list_tools()
        for tool in listing.tools:
            if not (tool.name == explicit if explicit else tool.name in spec['names']): continue
            ann = tool.annotations
            if spec['write'] and ann and getattr(ann, 'destructive_hint', None) is True: continue
            if not spec['write'] and not (ann and ann.read_only_hint is True): continue
            found.append(tool)
        cursor = getattr(listing, 'next_cursor', None)
        if not cursor: break
    if len(found) != 1: raise EtherChannelUnavailable(spec['missing'])
    return found[0]


def _run(fn, timeout=40):
    """Вызов MCP вне опроса ленты: ждём занятый опрос, а не отказываем пользователю сразу."""
    if not _LOCK.acquire(timeout=timeout): raise EtherMcpError('Эфир занят обновлением ленты. Повторите через несколько секунд.')
    try:
        async def bounded():
            with anyio.fail_after(timeout): return await fn()
        return anyio.run(bounded)
    except TimeoutError as exc: raise EtherMcpError('Эфир отвечает слишком долго. Повторите.') from exc
    finally: _LOCK.release()


def _dialog_kind(dialog):
    kind = str(dialog.get('type') or dialog.get('kind') or dialog.get('peer_type') or '').lower()
    if any(x in kind for x in ('group', 'chat', 'channel', 'space', 'room')): return 'group'
    return 'chat'


def _contact(row):
    name = str(row.get('display_name') or row.get('full_name') or row.get('name') or row.get('fio') or '').strip()
    login = str(row.get('login') or row.get('username') or '').strip()
    email = str(row.get('email') or row.get('mail') or '').strip()
    sub = ' · '.join(str(row[k]) for k in ('position', 'title', 'department', 'division') if row.get(k))
    peer = row.get('peer') or row.get('id') or row.get('user_id') or login or email
    return {'kind': 'person', 'name': name or login or email, 'login': login, 'email': email, 'subtitle': sub or email, 'peer': peer}


_DEMO_PEOPLE = [
    {'kind': 'person', 'name': 'Тюрин Сергей Павлович', 'login': 'tyurin_sp', 'email': 'tyurin@example.test', 'subtitle': 'QA · Команда SBER911'},
    {'kind': 'person', 'name': 'Тюрина Анна Олеговна', 'login': 'tyurina_ao', 'email': 'tyurina@example.test', 'subtitle': 'Аналитик'},
    {'kind': 'person', 'name': 'Михаил Орлов', 'login': 'orlov_m', 'email': 'orlov@example.test', 'subtitle': 'Backend · Интеграции'},
    {'kind': 'group', 'name': 'Команда QA', 'subtitle': 'Групповой чат'},
    {'kind': 'group', 'name': 'Релизная группа', 'subtitle': 'Групповой чат'},
]
_demo_threads: dict = {}


def search_participants(query):
    """Кого можно отслеживать: люди (поиск MCP, если объявлен) и чаты/группы из диалогов аккаунта."""
    q = ' '.join(str(query).split())
    if len(q) < 2: return {'items': [], 'people': True}
    low = q.casefold()
    if MOCK:
        items = [dict(x, peer={'demo': x['name']}) for x in _DEMO_PEOPLE if low in x['name'].casefold() or low in x.get('login', '').casefold()]
        return {'items': items, 'people': True}

    async def run():
        global _dialogs
        items, reason = [], ''
        async with open_client() as client:
            now = time.monotonic()
            if not _dialogs[1] or now - _dialogs[0] >= setting('ETHER_DIALOGS_TTL', 60):
                if _available(_dialog_budget, 10):
                    raw = await _call(client, 'chat_get_dialogs', {'scope': 'active', 'limit': 200, 'count': 200, 'offset': 0})
                    _dialogs = (now, _items(raw, 'dialogs', 'items', 'results'))
            for dialog in _dialogs[1]:
                name = str(dialog.get('name') or dialog.get('title') or '')
                if name and low in name.casefold():
                    items.append({'kind': _dialog_kind(dialog), 'name': name, 'subtitle': 'Групповой чат' if _dialog_kind(dialog) == 'group' else 'Личный чат',
                                  'peer': dialog.get('peer', dialog.get('conversation_peer'))})
            try:
                tool = await _tool_of(client, 'search')
                if not _available(_budget, 20): raise EtherMcpError('Достигнут бюджет запросов Эфира. Повторите через минуту.')
                raw = await _execute(client, tool, {'query': q, 'q': q, 'search': q, 'text': q, 'name': q, 'limit': 20, 'count': 20})
                items += [_contact(r) for r in _items(raw, 'users', 'contacts', 'people', 'items', 'results') if isinstance(r, dict)]
            except EtherChannelUnavailable as exc:
                reason = str(exc)
        seen, unique = set(), []
        for it in items:
            key = (it['kind'], it['name'].casefold())
            if it['name'] and key not in seen: seen.add(key); unique.append(it)
        return {'items': unique[:30], 'people': not reason, 'reason': reason}
    return _run(run)


def _thread_message(m):
    sender = m.get('sender') or {}
    sender = sender if isinstance(sender, dict) else {'name': str(sender)}
    at = as_time(m.get('date') or m.get('created_at'))
    return {'id': str(m.get('mid') or m.get('id') or (at.isoformat() if at else '')),
            'author': str(sender.get('name') or sender.get('display_name') or m.get('sender_name') or sender.get('login') or ''),
            'text': message_text(m), 'date': at.isoformat() if at else '',
            'mine': bool(m.get('out') or m.get('outgoing') or m.get('is_outgoing') or m.get('is_mine'))}


def get_thread(peer):
    """Переписка диалога: последние сообщения по возрастанию времени."""
    if MOCK:
        key = json.dumps(peer, sort_keys=True, ensure_ascii=False)
        base = _demo_threads.setdefault(key, [
            {'id': 'd1', 'author': 'Михаил Орлов', 'text': 'Нашёл причину таймаута в notification-service.', 'date': (datetime.now(timezone.utc) - timedelta(minutes=40)).isoformat(), 'mine': False},
            {'id': 'd2', 'author': 'Вы', 'text': 'Отлично, когда будет на ИФТ?', 'date': (datetime.now(timezone.utc) - timedelta(minutes=35)).isoformat(), 'mine': True},
            {'id': 'd3', 'author': 'Михаил Орлов', 'text': 'Исправление уже на проверке, через час выложим.', 'date': (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat(), 'mine': False},
        ])
        return {'messages': base, 'canSend': True}

    async def run():
        async with open_client() as client:
            if not _available(_budget, 20): raise EtherMcpError('Достигнут бюджет запросов Эфира. Повторите через минуту.')
            raw = await _call(client, 'chat_get_messages', {'peer': peer, 'limit': 50, 'count': 50, 'offset': 0})
            rows = _items(raw, 'messages', 'items', 'results')
            _messages[json.dumps(peer, sort_keys=True, ensure_ascii=False)] = (time.monotonic(), rows)
            try: await _tool_of(client, 'send'); can, reason = True, ''
            except EtherChannelUnavailable as exc: can, reason = False, str(exc)
        msgs = sorted((_thread_message(m) for m in rows if isinstance(m, dict)), key=lambda m: m['date'])
        return {'messages': msgs, 'canSend': can, 'reason': reason}
    return _run(run)


def send_message(peer, text):
    """Ответ в диалог — только по явному действию пользователя («Отправить»)."""
    text = str(text).strip()
    if not text: raise EtherMcpError('Пустое сообщение.')
    if MOCK:
        key = json.dumps(peer, sort_keys=True, ensure_ascii=False)
        _demo_threads.setdefault(key, []).append({'id': f'd{time.time_ns()}', 'author': 'Вы', 'text': text, 'date': datetime.now(timezone.utc).isoformat(), 'mine': True})
        return {'sent': True}

    async def run():
        async with open_client() as client:
            tool = await _tool_of(client, 'send')
            await _execute(client, tool, {'peer': peer, 'text': text, 'message': text, 'body': text}, write=True)
        _messages.pop(json.dumps(peer, sort_keys=True, ensure_ascii=False), None)
        _feed_cache.clear()
        return {'sent': True}
    try: return _run(run)
    except EtherChannelUnavailable as exc: raise EtherMcpError(str(exc)) from exc


def get_mail(message_id):
    """Письмо целиком; инструмента нет — available: false (окно покажет текст из ленты)."""
    if MOCK:
        return {'available': True, 'canReply': True, 'subject': 'Письмо', 'from': 'Михаил Орлов', 'to': 'Вы',
                'date': datetime.now(timezone.utc).isoformat(), 'text': 'Полный текст письма: исправление установлено, просьба повторить сценарий.'}

    async def run():
        async with open_client() as client:
            try: tool = await _tool_of(client, 'mail_read')
            except EtherChannelUnavailable as exc: return {'available': False, 'reason': str(exc)}
            if not _available(_budget, 20): raise EtherMcpError('Достигнут бюджет запросов Эфира. Повторите через минуту.')
            raw = await _execute(client, tool, {'id': message_id, 'message_id': message_id, 'uid': message_id})
            row = raw.get('data', raw) if isinstance(raw, dict) else {}
            row = row if isinstance(row, dict) else {}
            body = row.get('text') or row.get('body') or row.get('content') or row.get('preview') or ''
            if isinstance(body, dict): body = body.get('text') or body.get('content') or ''
            try: await _tool_of(client, 'mail_reply'); can, reason = True, ''
            except EtherChannelUnavailable as exc: can, reason = False, str(exc)
            to = row.get('to') or row.get('recipients') or []
            return {'available': True, 'canReply': can, 'replyReason': reason, 'subject': str(row.get('subject') or row.get('title') or ''),
                    'from': _person(row.get('from') or row.get('sender')), 'to': ', '.join(_person(x) for x in (to if isinstance(to, list) else [to]) if x),
                    'date': (as_time(row.get('date') or row.get('received_at')) or datetime.now(timezone.utc)).isoformat(),
                    'text': '[содержимое скрыто]' if row.get('confidential_hidden') else str(body)[:50000]}
    return _run(run)


def reply_mail(message_id, text):
    """Ответ на письмо — только по явному действию пользователя."""
    text = str(text).strip()
    if not text: raise EtherMcpError('Пустой ответ.')
    if MOCK: return {'sent': True}

    async def run():
        async with open_client() as client:
            tool = await _tool_of(client, 'mail_reply')
            await _execute(client, tool, {'id': message_id, 'message_id': message_id, 'uid': message_id, 'text': text, 'body': text}, write=True)
        _channels.pop('mail', None)
        return {'sent': True}
    try: return _run(run)
    except EtherChannelUnavailable as exc: raise EtherMcpError(str(exc)) from exc
