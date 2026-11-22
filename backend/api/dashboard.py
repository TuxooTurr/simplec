"""Shared Jira widgets. Counter entries remain pending until the team handles them."""
from __future__ import annotations
import asyncio
import os
import re
import threading
from datetime import datetime, timedelta
from typing import Literal
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from db import dashboard_store as store
from db.postgres import SessionLocal
from db.paths import MOCK
from backend.api.auth import require_user
from backend.api import jira_tool as jira

router = APIRouter(prefix='/api/dashboard', tags=['Dashboard'])
_busy: set[str] = set()
_guard = threading.Lock()
_monitor = None
_jobs: set[asyncio.Task] = set()
_queued: dict[str, asyncio.Task] = {}
GRID_COLUMNS = 128
SIZES = {'S': (4, 4), 'M': (8, 8), 'L': (16, 8), 'XL': (24, 12), 'XXL': (GRID_COLUMNS, 12)}

class Widget(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex, min_length=1, max_length=100, pattern=r'^[\w-]+$')
    title: str = Field(min_length=1, max_length=200)
    jql: str = Field(min_length=1, max_length=4000)
    kind: Literal['view', 'counter'] = 'view'
    size: Literal['S', 'M', 'L', 'XL', 'XXL'] = 'M'
    presentation: Literal['list', 'donut', 'bar'] = 'list'
    x: int | None = Field(default=None, ge=0, le=GRID_COLUMNS - 1)
    y: int | None = Field(default=None, ge=0, le=4096)
    w: int | None = Field(default=None, ge=3, le=GRID_COLUMNS)
    h: int | None = Field(default=None, ge=4, le=64)
    fullWidth: bool = False
    gridVersion: Literal[2] = 2
    palette: Literal['indigo', 'ocean', 'forest', 'warm', 'spectrum'] = 'indigo'
    colors: dict[str, str] = Field(default_factory=dict, max_length=100)
    groupField: str = Field(default='status', max_length=100)
    stListId: str = Field(default='', max_length=100)
    columns: list[str] = Field(default_factory=lambda: ['key', 'summary', 'status', 'assignee'], min_length=1, max_length=100)
    valueField: str = Field(default='', max_length=100)
    period: Literal['all', 'today', 'week', 'custom'] = 'all'
    fromDate: str = ''
    toDate: str = ''

    @model_validator(mode='before')
    @classmethod
    def migrate(cls, value):
        if not isinstance(value, dict): return value
        value = dict(value)
        if value.get('kind') in ('donut', 'bar'):
            value['presentation'] = value['kind']
            value['kind'] = 'view'
        if 'columns' not in value and value.get('kind') == 'counter':
            value['columns'] = ['key', 'type', 'summary', 'status', 'priority', 'assignee']
        if value.get('gridVersion') != 2:
            old = {'S': (4, 4), 'M': (4, 6), 'L': (6, 8), 'XL': (8, 10)}
            name = value.get('size', 'M')
            if name in old and (value.get('w'), value.get('h')) == old[name]:
                value['w'], value['h'] = SIZES[name]
            value['gridVersion'] = 2
        if value.get('size') == 'XXL' and 'fullWidth' not in value:
            value['fullWidth'] = True
        return value

    @model_validator(mode='after')
    def geometry(self):
        if any(not column or len(column) > 300 for column in self.columns):
            raise ValueError('Некорректное поле списка.')
        self.columns = list(dict.fromkeys(['key', *self.columns]))
        if self.kind == 'counter':
            self.size, self.w, self.h = 'S', 4, 4
            self.fullWidth = False
        if self.fullWidth:
            self.x, self.w = 0, GRID_COLUMNS
        width, height = SIZES[self.size]
        self.w = self.w or width
        self.h = self.h or height
        if self.x is not None and self.x + self.w > GRID_COLUMNS:
            raise ValueError('Виджет выходит за границы сетки.')
        if any(len(label) > 300 or not re.fullmatch(r'#[0-9a-fA-F]{6}', color) for label, color in self.colors.items()):
            raise ValueError('Цвет группы должен быть в формате #RRGGBB.')
        return self


def positioned(widgets, *, repair=False):
    """Migrate legacy rows without modifying queues or writing during GET."""
    result = []
    for raw in widgets:
        if repair and raw.get('kind') == 'counter' and raw.get('x') is not None:
            raw = {**raw, 'x': min(GRID_COLUMNS - 4, raw['x'])}
        widget = Widget.model_validate(raw).model_dump()
        x, y = widget['x'], widget['y']
        if x is None or y is None:
            x, y = 0, 0
            while any(x < other['x'] + other['w'] and x + widget['w'] > other['x'] and
                      y < other['y'] + other['h'] and y + widget['h'] > other['y'] for other in result):
                x += 1
                if x + widget['w'] > GRID_COLUMNS: x, y = 0, y + 1
        elif repair:
            while True:
                collision = next((other for other in result if x < other['x'] + other['w'] and x + widget['w'] > other['x'] and
                                  y < other['y'] + other['h'] and y + widget['h'] > other['y']), None)
                if collision is None: break
                y = collision['y'] + collision['h']
        widget.update(x=x, y=y)
        result.append(widget)
    return result

class Layout(BaseModel):
    version: int
    widgets: list[Widget] = Field(max_length=50)

class Mark(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=1000)
    processed: bool = True


def can_edit(user):
    editors = os.getenv('DASHBOARD_EDITORS', '16538296').split(',')
    return user.get('login') in {e.strip() for e in editors} or (
        'DASHBOARD_EDITORS' not in os.environ and user.get('source') == 'local' and user.get('role') == 'superuser')

@router.get('')
def get_dashboard(user=Depends(require_user)):
    data = store.read()
    return {'version': data['version'], 'widgets': positioned(data['widgets'], repair=True), 'canEdit': can_edit(user), 'demo': MOCK}

@router.put('/layout')
def save_layout(body: Layout, user=Depends(require_user)):
    if not can_edit(user): raise HTTPException(403, 'Раскладку может менять только редактор Главной.')
    if len({w.id for w in body.widgets}) != len(body.widgets): raise HTTPException(422, 'Идентификаторы виджетов повторяются.')
    for widget in body.widgets: query_for(widget.model_dump())
    widgets = positioned([w.model_dump() for w in body.widgets])
    for i, a in enumerate(widgets):
        for b in widgets[i + 1:]:
            if a['x'] < b['x'] + b['w'] and a['x'] + a['w'] > b['x'] and a['y'] < b['y'] + b['h'] and a['y'] + a['h'] > b['y']:
                raise HTTPException(422, 'Виджеты пересекаются. Разместите их в свободных ячейках.')
    try: store.layout(widgets, body.version)
    except ValueError as exc: raise HTTPException(409, str(exc)) from exc
    return get_dashboard(user)


def query_for(widget):
    jql = widget['jql'].strip()
    # Find ORDER BY outside quoted JQL text before adding optional date conditions.
    quote = None; escaped = False; order = None
    for i, ch in enumerate(jql):
        if escaped: escaped = False; continue
        if ch == '\\': escaped = True; continue
        if quote:
            if ch == quote: quote = None
        elif ch in "\"'": quote = ch
        elif re.match(r'\border\s+by\b', jql[i:], re.I): order = i; break
    suffix = jql[order:] if order is not None else 'ORDER BY created ASC, key ASC'
    base = jql[:order].strip() if order is not None else jql
    period = widget.get('period', 'all')
    if period == 'today': base = f'({base}) AND created >= startOfDay()'
    elif period == 'week': base = f'({base}) AND created >= startOfDay(-6d)'
    elif period == 'custom':
        for key in ('fromDate', 'toDate'):
            try: datetime.strptime(widget.get(key, ''), '%Y-%m-%d')
            except ValueError: raise HTTPException(422, 'Для периода укажите начало и окончание.')
        a, b = widget['fromDate'], widget['toDate']
        if b < a: raise HTTPException(422, 'Окончание периода раньше начала.')
        end = (datetime.strptime(b, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
        base = f'({base}) AND created >= "{a}" AND created < "{end}"'
    return base + ' ' + suffix


def observed_issue(raw, base_url):
    issue = jira.norm_issue(raw, base_url)
    status = (raw.get('fields') or {}).get('status')
    issue['_statusId'] = str(status.get('id') or '') if isinstance(status, dict) else ''
    changes = []
    for history in (raw.get('changelog') or {}).get('histories') or []:
        for item in history.get('items') or []:
            if item.get('field') != 'status': continue
            before, after = item.get('from'), item.get('to')
            if before is not None and after is not None and before == after: continue
            changes.append({'at': history.get('created'), 'from': item.get('fromString') or before or '',
                            'to': item.get('toString') or after or '',
                            'by': (history.get('author') or {}).get('displayName') or ''})
    issue['_statusChanges'] = changes
    return issue

def refresh(widget_id):
    layout_version = None
    with _guard:
        if widget_id in _busy: return
        _busy.add(widget_id)
    try:
        data = store.read()
        layout_version = data['version']
        widget = next((w for w in data['widgets'] if w['id'] == widget_id), None)
        if not widget: return
        with SessionLocal() as db:
            cfg = jira._load_cfg(db)
            expansion = {'expand': 'changelog'} if widget['kind'] == 'counter' else {}
            selected = [*widget.get('columns', []), widget.get('groupField', ''), widget.get('valueField', '')]
            fields = [field for field in selected if field not in ('key', 'type') and re.fullmatch(r'[A-Za-z][\w]*', field)]
            if fields: expansion['fields'] = ','.join(dict.fromkeys(['*navigable', *fields]))
            raw, total = jira._search(cfg, query_for(widget), limit=20000, **expansion)
            issues = [observed_issue(i, cfg['base_url']) for i in raw]
            retained = []
            # Fetch outstanding retained work even after it leaves a sliding JQL window.
            if widget['kind'] == 'counter':
                known = (data.get('queues', {}).get(widget_id, {}).get('entries') or {})
                current = {i['key'] for i in issues}
                missing = [k for k, e in known.items() if not e.get('processedAt') and k not in current]
                for batch in jira._chunks(missing, 1000):
                    fetched = jira._by_keys(cfg, batch, **expansion)
                    retained.extend(observed_issue(issue, cfg['base_url']) for issue in fetched)
            store.observe(widget_id, issues, retained=retained, partial=total > len(raw), layout_version=layout_version,
                          error='Jira вернула больше 20 000 задач. Сузьте фильтр: выдача неполная.' if total > len(raw) else '')
    except Exception as exc:
        text = str(exc.detail)[:500] if isinstance(exc, HTTPException) else 'Не удалось обновить Jira. Сохранён предыдущий результат.'
        store.observe(widget_id, None, error=text, layout_version=layout_version)
    finally:
        with _guard: _busy.discard(widget_id)

@router.get('/widgets/{widget_id}/data')
def widget_data(widget_id: str, user=Depends(require_user)):
    data = store.read()
    widget = next((w for w in data['widgets'] if w['id'] == widget_id), None)
    if not widget: raise HTTPException(404, 'Виджет удалён.')
    queue = data.get('queues', {}).get(widget_id, {})
    entries = queue.get('entries', {})
    current = set(queue.get('currentKeys', []))
    items = [{**e['issue'], 'firstSeenAt': e['firstSeenAt'], 'processedAt': e.get('processedAt'),
              'processedBy': e.get('processedBy'), 'processedReason': e.get('processedReason'),
              'statusChange': e.get('statusChange'), 'inFilter': k in current} for k, e in entries.items()
             if widget['kind'] == 'counter' or k in current]
    return {**{k: v for k, v in queue.items() if k not in ('entries', 'currentKeys')}, 'items': items,
            'running': widget_id in _busy or widget_id in _queued, 'pending': sum(not e.get('processedAt') for e in items)}

@router.post('/widgets/{widget_id}/refresh', status_code=202)
async def refresh_widget(widget_id: str, user=Depends(require_user)):
    if not any(w['id'] == widget_id for w in store.read()['widgets']): raise HTTPException(404, 'Виджет удалён.')
    # The monitor and browser share the same single-flight worker.
    launch(widget_id)
    return {'running': True}

@router.post('/widgets/{widget_id}/processed')
def mark_processed(widget_id: str, body: Mark, user=Depends(require_user)):
    try: store.processed(widget_id, body.keys, body.processed, user['login'])
    except KeyError: raise HTTPException(404, 'Виджет удалён.')
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc
    return widget_data(widget_id, user)

class Chat(BaseModel):
    users: list[str] = Field(default_factory=list, max_length=100)
    keywords: list[str] = Field(default_factory=list, max_length=100)
    channel: Literal['chat', 'mail', 'meetings'] = 'chat'

    @model_validator(mode='after')
    def bounds(self):
        if any(len(value) > 200 for value in self.users + self.keywords):
            raise ValueError('Имя, слово или фраза не должны превышать 200 символов.')
        return self

@router.post('/chat')
def chat(body: Chat, user=Depends(require_user)):
    from agents import ether_mcp
    if not ether_mcp.configured(): return {'source': 'ether', 'configured': False, 'available': True, 'messages': []}
    try: return {'source': 'ether', 'configured': True, **ether_mcp.fetch_channel(body.channel, body.users, body.keywords)}
    except ether_mcp.EtherMcpError as exc: raise HTTPException(502, str(exc)) from exc

def launch(widget_id):
    if widget_id in _queued: return _queued[widget_id]
    task = asyncio.create_task(asyncio.to_thread(refresh, widget_id))
    _queued[widget_id] = task
    _jobs.add(task)
    def finished(done):
        _jobs.discard(done)
        if _queued.get(widget_id) is done: _queued.pop(widget_id, None)
    task.add_done_callback(finished)
    return task

async def _watch():
    while True:
        try:
            for widget in store.read()['widgets']:
                await asyncio.shield(launch(widget['id']))
        except Exception: pass
        await asyncio.sleep(30)

async def start():
    global _monitor
    _monitor = asyncio.create_task(_watch())

async def stop():
    global _monitor
    if _monitor:
        _monitor.cancel()
        await asyncio.gather(_monitor, return_exceptions=True)
        _monitor = None
    if _jobs: await asyncio.gather(*list(_jobs), return_exceptions=True)
