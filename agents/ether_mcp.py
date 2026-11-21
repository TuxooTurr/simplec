"""Read-only Efir feed; process caches and a rolling account request budget."""
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

async def _execute(client, tool, args):
    if tool.annotations and tool.annotations.read_only_hint is False: raise EtherMcpError('Инструмент Эфира не объявлен для чтения.')
    props = tool.input_schema.get('properties', {})
    values = {k:v for k,v in args.items() if k in props}
    if set(tool.input_schema.get('required', [])) - values.keys(): raise EtherMcpError('Изменился контракт MCP Эфира. Проверьте параметры инструмента.')
    result = await client.call_tool(tool.name, values)
    if result.is_error: raise EtherMcpError('Эфир отклонил запрос. Проверьте сессию и права чтения.')
    if result.structured_content is not None: return result.structured_content
    try: return json.loads('\n'.join(b.text for b in result.content if b.type == 'text'))
    except (ValueError, TypeError): raise EtherMcpError('Не распознан ответ MCP Эфира.')

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
                if not text or not at or at<oldest or not matches_tracking([author, login], text + ' ' + dialog_name, filters, keywords): continue
                identifier=str(message.get('mid') or message.get('id') or at.isoformat())
                result.append({'id':cache_key+':'+identifier,'author':author or login,'text':text,'date':at.isoformat(),
                               'dialog':str(dialog.get('name') or dialog.get('title') or '')})
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

def _demo_feed(channel, users, keywords):
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
        if not matches_tracking([person], title + ' ' + text + ' ' + dialog, users, keywords): continue
        at = now + timedelta(hours=i + 1) if channel == 'meetings' else now - timedelta(minutes=i * 17 + 3)
        item = {'id': 'demo-' + identifier, 'author': person, 'dialog': dialog, 'title': title, 'text': text, 'date': at.isoformat()}
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
        item = {'id': channel + ':' + str(identifier), 'author': author, 'title': title, 'text': str(text)[:12000],
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
    if not users and not keywords: return {'available': True, 'messages': []}
    if MOCK: return {'available': True, 'demo': True, 'messages': _demo_feed(channel, users, keywords)}
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
            if matches_tracking(item['_people'], item['title'] + ' ' + item['text'], users, keywords):
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
