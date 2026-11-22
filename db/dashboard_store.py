"""Shared dashboard layout and durable per-widget team inboxes (single API worker)."""
from __future__ import annotations
import copy
import json
import os
import threading
from datetime import datetime, timezone
from tempfile import NamedTemporaryFile
from db.paths import DATA_DIR

FILE = DATA_DIR / 'dashboard.json'
LOCK = threading.RLock()

def stamp():
    return datetime.now(timezone.utc).isoformat()

def read():
    with LOCK:
        try:
            data = json.loads(FILE.read_text(encoding='utf-8'))
        except FileNotFoundError:
            data = {'version': 0, 'widgets': [], 'queues': {}}
        if not isinstance(data, dict) or not isinstance(data.get('widgets'), list):
            raise ValueError('Повреждено хранилище Главной; восстановите резервную копию.')
        return copy.deepcopy(data)

def write(data):
    FILE.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile('w', encoding='utf-8', dir=FILE.parent, delete=False) as tmp:
        try:
            json.dump(data, tmp, ensure_ascii=False)
            tmp.close()
            os.replace(tmp.name, FILE)
        finally:
            if os.path.exists(tmp.name): os.unlink(tmp.name)

def layout(widgets, version):
    with LOCK:
        data = read()
        if version != data['version']:
            raise ValueError('Раскладку изменил другой пользователь. Обновите страницу перед сохранением.')
        previous = {w['id']: w for w in data['widgets']}
        for widget in widgets:
            old = previous.get(widget['id'])
            if old and any(old.get(k) != widget.get(k) for k in ('jql', 'period', 'fromDate', 'toDate')):
                # Preserve pending work when changing the filter; make its provenance explicit.
                queue = data.get('queues', {}).get(widget['id'], {})
                queue['filterChangedAt'] = stamp()
        data['widgets'], data['version'] = widgets, version + 1
        write(data)
        return data

def _time(value):
    try:
        result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)
    except (ValueError, TypeError): return None

def _observe_status(entry, issue, when):
    old = entry.get('observedStatus') or {'id': '', 'name': (entry.get('issue', {}).get('fields') or {}).get('status', '')}
    new = {'id': issue.get('_statusId', ''), 'name': (issue.get('fields') or {}).get('status', '')}
    cutoff = _time(entry.get('autoAfter') or entry['firstSeenAt'])
    events = [event for event in issue.get('_statusChanges', []) if _time(event.get('at')) and cutoff and
              cutoff < _time(event['at']) <= _time(when)]
    event = max(events, key=lambda e: _time(e['at'])) if events else None
    changed = old['id'] != new['id'] if old.get('id') and new.get('id') else bool(old.get('name') and new.get('name') and old['name'] != new['name'])
    # After an explicit undo adopt the next observed baseline; old history cannot immediately hide it again.
    baseline_after_undo = bool(entry.get('autoAfter') and _time(entry['autoAfter']) > (_time(entry.get('lastSeenAt')) or _time(entry['firstSeenAt'])))
    if not entry.get('processedAt') and (event or changed and not baseline_after_undo):
        entry.update(processedAt=when, processedBy='Автоматически', processedReason='status-change',
                     statusChange=event or {'from': old['name'], 'to': new['name'], 'at': when})
        entry.setdefault('history', []).append({'at': when, 'by': 'Автоматически', 'processed': True,
                                               'reason': 'status-change', 'change': entry['statusChange']})
    if new['id'] or new['name']: entry['observedStatus'] = new

def observe(widget_id, issues, *, retained=(), error='', partial=False, layout_version=None):
    with LOCK:
        data = read()
        if layout_version is not None and data['version'] != layout_version: return
        widget = next((w for w in data['widgets'] if w['id'] == widget_id), None)
        if not widget: return
        queue = data.setdefault('queues', {}).setdefault(widget_id, {'entries': {}})
        queue['lastAttemptAt'] = stamp()
        queue['error'] = error
        if issues is not None:
            when = stamp()
            for issue in [*issues, *retained]:
                entry = queue['entries'].setdefault(issue['key'], {'firstSeenAt': when, 'processedAt': None, 'processedBy': None})
                if widget['kind'] == 'counter': _observe_status(entry, issue, when)
                entry.update(issue={k: v for k, v in issue.items() if not k.startswith('_')}, lastSeenAt=when)
            queue.update(currentKeys=[i['key'] for i in issues], lastCheckedAt=when, partial=partial)
        write(data)

def processed(widget_id, keys, value, actor):
    with LOCK:
        data = read()
        if not any(w['id'] == widget_id for w in data['widgets']): raise KeyError(widget_id)
        queue = data.setdefault('queues', {}).setdefault(widget_id, {'entries': {}})
        unknown = set(keys) - queue['entries'].keys()
        if unknown: raise ValueError('Задачи ещё не получены виджетом: ' + ', '.join(sorted(unknown)[:10]))
        when = stamp()
        for key in keys:
            entry = queue['entries'][key]
            if bool(entry.get('processedAt')) == value: continue
            entry['processedAt'], entry['processedBy'] = (when, actor) if value else (None, None)
            entry['processedReason'] = 'manual' if value else None
            entry.pop('statusChange', None)
            if not value: entry['autoAfter'] = when
            # History survives undo and is shared with every browser.
            entry.setdefault('history', []).append({'at': when, 'by': actor, 'processed': value})
        write(data)
