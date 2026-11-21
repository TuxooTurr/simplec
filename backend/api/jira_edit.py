"""Single and bulk issue editing. Never send fields absent from each issue's edit screen."""
from __future__ import annotations
import asyncio
import threading
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from db.postgres import get_db, SessionLocal
from backend.api.auth import require_user
from backend.api import jira_tool as jira
from backend.api import jira_constants as constants

router = APIRouter(prefix='/api/jira/tool', tags=['Jira edit'], dependencies=[Depends(require_user)])
EXCLUDED = {'status', 'project', 'attachment', 'issuelinks', 'worklog', 'comment', 'timetracking', 'parent'}
SUPPORTED = {'string', 'number', 'date', 'datetime', 'user', 'issuetype', 'priority', 'option', 'array', 'resolution', 'component', 'version'}
PRIMARY = {'summary', 'description', 'issuetype', 'priority', 'assignee', 'reporter', 'components', 'labels', 'environment',
           'fixVersions', 'duedate', constants.FIELD_KE, constants.FIELD_IT_SERVICE,
           constants.FIELD_EPIC_LINK, constants.FIELD_STAND_TYPE}

def form_value(field, raw):
    if raw is None: return ''
    kind = (field.get('schema') or {}).get('type')
    if isinstance(raw, list): return '\n'.join(form_value({'schema': {'type': (field.get('schema') or {}).get('items')},
                                                         **({'allowedValues': field['allowedValues']} if 'allowedValues' in field else {})}, item) for item in raw)
    if isinstance(raw, dict):
        value = raw.get('name', raw.get('key', '')) if kind == 'user' else (
            raw.get('id', raw.get('value', raw.get('name', ''))) if 'allowedValues' in field else raw.get('value', raw.get('name', raw.get('id', ''))))
        return str(value or '')
    return str(raw)

class Keys(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=200)

class Edit(Keys):
    fields: dict[str, str | None] = Field(min_length=1, max_length=30)

def keys_of(keys):
    result = jira._clean_keys(keys)
    if not result or any(not jira._KEY_RE.fullmatch(k.strip().upper()) for k in keys): raise HTTPException(422, 'Выберите корректные задачи Jira.')
    return result

def editable(meta):
    return {k: v for k, v in meta.items() if k not in EXCLUDED and (v.get('schema') or {}).get('type') in SUPPORTED
            and 'set' in v.get('operations', ['set'])}

@router.post('/edit-meta')
def metadata(body: Keys, db: Session = Depends(get_db)):
    cfg = jira._load_cfg(db); common = None; errors = {}
    for key in keys_of(body.keys):
        try:
            meta = editable((jira._jira_request(cfg, 'GET', f'/rest/api/2/issue/{key}/editmeta') or {}).get('fields', {}))
            if common is None: common = meta
            else:
                common = {k: v for k, v in common.items() if k in meta and v.get('schema') == meta[k].get('schema')}
                for k, field in common.items():
                    field['required'] = bool(field.get('required') or meta[k].get('required'))
                    if 'allowedValues' in field or 'allowedValues' in meta[k]:
                        allowed = {str(v.get('id', v.get('value', v.get('name', '')))) for v in meta[k].get('allowedValues', [])}
                        field['allowedValues'] = [v for v in field.get('allowedValues', [])
                                                  if str(v.get('id', v.get('value', v.get('name', '')))) in allowed]
        except HTTPException as exc:
            errors[key] = str(exc.detail)[:300]
            break
    if common:
        common = {k:v for k,v in common.items() if v.get('allowedValues') != []}
    # One failed screen must not accidentally permit a field across an unknown issue.
    if errors: common = {}
    values = {}
    if common:
        try:
            rows = {row['key']: row.get('fields') or {} for row in jira._by_keys(cfg, keys_of(body.keys), fields='*all')}
            if set(keys_of(body.keys)) - rows.keys(): raise ValueError('Не все задачи доступны для чтения.')
            for fid, field in common.items():
                current = [form_value(field, rows[key].get(fid)) for key in keys_of(body.keys)]
                mixed = len(set(current)) > 1
                values[fid] = {'value': '' if mixed else current[0], 'mixed': mixed,
                               'displayValue': '' if mixed else jira.norm_value(rows[keys_of(body.keys)[0]].get(fid))}
        except (HTTPException, ValueError):
            errors['values'] = 'Не удалось прочитать текущие значения задач. Обновите форму.'
            common = {}
    return {'fields': {k: {'name': v.get('name', k), 'schema': v.get('schema', {}), 'required': bool(v.get('required')),
                           'primary': k in PRIMARY or bool(v.get('required')) or ('план' in str(v.get('name', '')).lower() and any(word in str(v.get('name', '')).lower() for word in ('нач', 'окон', 'конец'))),
                           **values.get(k, {}),
                           'allowed': [{'id': str(x.get('id', x.get('value', x.get('name', '')))),
                                        'name': str(x.get('name', x.get('value', x.get('displayName', ''))))}
                                       for x in v.get('allowedValues', [])]} for k, v in (common or {}).items()}, 'errors': errors}

def payload(field, value):
    if value is None:
        if field.get('required'): raise ValueError('Обязательное поле нельзя очистить.')
        return [] if field.get('schema', {}).get('type') == 'array' else None
    schema = field.get('schema') or {}; kind = schema.get('type')
    allowed = field.get('allowedValues')
    def option(item):
        hit = next((x for x in (allowed or []) if item in (str(x.get('id', '')), str(x.get('value', '')), str(x.get('name', '')))), None)
        if allowed is not None and hit is None: raise ValueError('Значение не разрешено Jira для этой задачи.')
        return {'id': str(hit['id'])} if hit and hit.get('id') is not None else ({'value': item} if kind == 'option' or schema.get('items') == 'option' else {'name': item})
    if kind == 'number': return float(value.replace(',', '.'))
    if kind == 'user': return {'name': value.strip()}
    if kind in ('option', 'issuetype', 'priority', 'resolution', 'component', 'version'): return option(value)
    if kind == 'array':
        values = [s.strip() for s in value.split('\n') if s.strip()]
        items = schema.get('items')
        if items == 'user': return [{'name': s} for s in values]
        return values if items == 'string' else [option(s) for s in values]
    return value

@router.post('/edit')
def update(body: Edit, db: Session = Depends(get_db)):
    cfg = jira._load_cfg(db); results = []
    for key in keys_of(body.keys):
        try:
            meta = editable((jira._jira_request(cfg, 'GET', f'/rest/api/2/issue/{key}/editmeta') or {}).get('fields', {}))
            missing = body.fields.keys() - meta.keys()
            if missing: raise ValueError('Поля отсутствуют на экране редактирования: ' + ', '.join(sorted(missing)))
            fields = {fid: payload(meta[fid], value) for fid, value in body.fields.items()}
            jira._jira_request(cfg, 'PUT', f'/rest/api/2/issue/{key}', json_body={'fields': fields})
            results.append({'key': key, 'ok': True})
        except (HTTPException, ValueError, TypeError) as exc:
            results.append({'key': key, 'ok': False, 'error': str(exc.detail if isinstance(exc, HTTPException) else exc)[:500]})
    return {'results': results, 'done': sum(r['ok'] for r in results)}


_jobs = {}

@router.post('/edit-jobs', status_code=202)
async def start_edit(body: Edit, user=Depends(require_user)):
    keys = keys_of(body.keys)
    if sum(j['status'] == 'running' for j in _jobs.values()) >= 4:
        raise HTTPException(429, 'Сейчас выполняется несколько изменений. Повторите позже.')
    identifier = uuid4().hex
    job = {'owner': user['login'], 'status': 'running', 'results': [], 'total': len(keys), 'cancel': threading.Event()}
    _jobs[identifier] = job
    def work():
        try:
            with SessionLocal() as db:
                for key in keys:
                    if job['cancel'].is_set(): break
                    result = update(Edit(keys=[key], fields=body.fields), db)
                    job['results'].extend(result['results'])
            job['status'] = 'cancelled' if job['cancel'].is_set() else 'done'
        except Exception:
            job['status'] = 'error'
            job['error'] = 'Операция прервана. Сохранённые результаты показаны ниже; проверьте оставшиеся задачи.'
    async def run():
        try: await asyncio.to_thread(work)
        finally: asyncio.get_running_loop().call_later(600, _jobs.pop, identifier, None)
    job['task'] = asyncio.create_task(run())
    return {'id': identifier}

@router.get('/edit-jobs/{identifier}')
def edit_state(identifier: str, user=Depends(require_user)):
    job = _jobs.get(identifier)
    if not job or job['owner'] != user['login']: raise HTTPException(404, 'Операция не найдена.')
    return {k: list(v) if k == 'results' else v for k,v in job.items() if k not in ('owner','cancel','task')}

@router.delete('/edit-jobs/{identifier}')
def cancel_edit(identifier: str, user=Depends(require_user)):
    edit_state(identifier, user)
    _jobs[identifier]['cancel'].set()
    return {'cancelled': True}

async def stop_jobs():
    for job in _jobs.values(): job['cancel'].set()
    await asyncio.gather(*(job['task'] for job in list(_jobs.values())), return_exceptions=True)
