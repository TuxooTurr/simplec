import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from db import dashboard_store as store
from backend.api import dashboard as api

@pytest.fixture
def dashboard(tmp_path, monkeypatch):
    monkeypatch.setattr(store,'FILE',tmp_path/'dashboard.json')
    widget=api.Widget(id='inbox',title='Входящие',jql='project = QA',kind='counter').model_dump()
    store.layout([widget],0)
    return widget

def issue(n): return {'key':f'QA-{n}','fields':{'summary':f'Задача {n}'},'url':f'https://jira.test/browse/QA-{n}'}

def test_queue_survives_sliding_filter_and_restart_and_team_marks(dashboard):
    store.observe('inbox',[issue(1),issue(2)])
    store.processed('inbox',['QA-1'],True,'alice')
    store.observe('inbox',[])
    view=api.widget_data('inbox',{'login':'bob'})
    assert view['pending']==1 and len(view['items'])==2
    assert all(not i['inFilter'] for i in view['items'])
    done=next(i for i in view['items'] if i['key']=='QA-1')
    assert done['processedBy']=='alice' and done['processedAt']
    store.processed('inbox',['QA-1'],False,'bob')
    assert api.widget_data('inbox',{})['pending']==2
    history=store.read()['queues']['inbox']['entries']['QA-1']['history']
    assert [e['by'] for e in history]==['alice','bob']

def test_error_does_not_zero_queue_or_replace_success_timestamp(dashboard):
    store.observe('inbox',[issue(1)])
    stamp=api.widget_data('inbox',{})['lastCheckedAt']
    store.observe('inbox',None,error='Jira недоступна')
    view=api.widget_data('inbox',{})
    assert view['pending']==1 and view['error'] and view['lastCheckedAt']==stamp

def test_stale_refresh_cannot_overwrite_restored_layout(dashboard):
    old_version = store.read()['version']
    store.layout([dashboard], old_version)
    store.observe('inbox', [issue(1)], layout_version=old_version)
    assert not store.read().get('queues')

def test_refresh_race_does_not_erase_processed_and_marks_idempotent(dashboard):
    store.observe('inbox',[issue(1)])
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda _:store.processed('inbox',['QA-1'],True,'alice'),range(2)))
    store.observe('inbox',[issue(1),issue(2)])
    data=store.read()['queues']['inbox']['entries']
    assert data['QA-1']['processedAt'] and len(data['QA-1']['history'])==1
    assert not data['QA-2']['processedAt']

def test_layout_permissions_and_optimistic_lock(dashboard,monkeypatch):
    monkeypatch.setenv('DASHBOARD_EDITORS','alice')
    # Не-редактор не удаляет и не добавляет общие виджеты: пустая раскладка оставляет общий на месте.
    assert [w['id'] for w in api.save_layout(api.Layout(version=1,widgets=[]),{'login':'bob','role':'superuser'})['widgets']]==['inbox']
    with pytest.raises(HTTPException) as exc:
        api.save_layout(api.Layout(version=2,widgets=[api.Widget(**dashboard),api.Widget(id='new',title='Общий',jql='project = QA')]),{'login':'bob'})
    assert exc.value.status_code==403
    assert api.save_layout(api.Layout(version=2,widgets=[api.Widget(**dashboard)]),{'login':'alice'})['version']==3
    with pytest.raises(ValueError):store.layout([],1)

def test_changed_filter_does_not_clear_existing_pending(dashboard):
    store.observe('inbox',[issue(1)])
    store.layout([{**dashboard,'jql':'project = OTHER'}],1)
    assert api.widget_data('inbox',{})['pending']==1
    assert 'filterChangedAt' in store.read()['queues']['inbox']

def test_columns_persist_in_order_without_changing_queue(dashboard, monkeypatch):
    store.observe('inbox', [issue(1)])
    store.processed('inbox', ['QA-1'], True, 'alice')
    before = store.read()['queues']
    widget = api.Widget(**{**dashboard, 'columns': ['summary', 'customfield_123', 'st:ms', 'summary']})
    store.layout([widget.model_dump()], 1)
    assert store.read()['widgets'][0]['columns'] == ['key', 'summary', 'customfield_123', 'st:ms']
    assert store.read()['queues'] == before
    captured = []
    monkeypatch.setattr(api, 'SessionLocal', lambda: nullcontext(None))
    monkeypatch.setattr(api.jira, '_load_cfg', lambda db: {'base_url': 'https://jira.test'})
    monkeypatch.setattr(api.jira, '_search', lambda *args, **kwargs: (captured.append(kwargs) or [], 0))
    api.refresh('inbox')
    assert 'customfield_123' in captured[0]['fields'] and 'st:ms' not in captured[0]['fields']
    assert captured[0]['expand'] == 'changelog'

def test_legacy_column_defaults_preserve_each_table_kind():
    view = api.Widget(title='Список', jql='project = QA')
    counter = api.Widget(title='Очередь', jql='project = QA', kind='counter')
    assert view.columns == ['key', 'summary', 'status', 'assignee']
    assert counter.columns == ['key', 'type', 'summary', 'status', 'priority', 'assignee']

def test_any_jql_with_order_and_custom_time_window(dashboard):
    query=api.query_for({**dashboard,'jql':'text ~ "order by" ORDER BY priority DESC','period':'custom','fromDate':'2026-11-01','toDate':'2026-11-21'})
    assert query=='(text ~ "order by") AND created >= "2026-11-01" AND created < "2026-11-22" ORDER BY priority DESC'
    with pytest.raises(HTTPException):api.query_for({**dashboard,'period':'custom','fromDate':'bad','toDate':'bad'})

def test_refresh_retains_entries_and_refreshes_their_metadata(dashboard,monkeypatch):
    store.observe('inbox',[issue(1)])
    monkeypatch.setattr(api,'SessionLocal',lambda:nullcontext(None))
    monkeypatch.setattr(api.jira,'_load_cfg',lambda db:{'base_url':'https://jira.test'})
    monkeypatch.setattr(api.jira,'_search',lambda *a,**k:([{'key':'QA-2','fields':{'summary':'Новая'}}],1))
    monkeypatch.setattr(api.jira,'_by_keys',lambda *a,**k:[{'key':'QA-1','fields':{'summary':'Переименованная'}}])
    api.refresh('inbox')
    result=api.widget_data('inbox',{})
    assert result['pending']==2
    retained=next(i for i in result['items'] if i['key']=='QA-1')
    assert retained['fields']['summary']=='Переименованная' and not retained['inFilter']

def test_partial_source_is_explicit_and_pending_not_lost(dashboard,monkeypatch):
    monkeypatch.setattr(api,'SessionLocal',lambda:nullcontext(None))
    monkeypatch.setattr(api.jira,'_load_cfg',lambda db:{'base_url':'https://jira.test'})
    monkeypatch.setattr(api.jira,'_search',lambda *a,**k:([{'key':'QA-2','fields':{}}],25000))
    api.refresh('inbox')
    view=api.widget_data('inbox',{})
    assert view['partial'] and view['error'] and view['pending']==1

def test_unknown_mark_is_atomic(dashboard):
    store.observe('inbox',[issue(1)])
    with pytest.raises(ValueError):store.processed('inbox',['QA-1','QA-999'],True,'alice')
    assert api.widget_data('inbox',{})['pending']==1

def test_status_change_auto_processes_and_undo_does_not_replay_old_history(dashboard):
    store.observe('inbox', [{**issue(1), '_statusId': '1', 'fields': {'status': 'Открыт'}}])
    assert api.widget_data('inbox', {})['pending'] == 1
    store.observe('inbox', [{**issue(1), '_statusId': '2', 'fields': {'status': 'В работе'}}])
    data = api.widget_data('inbox', {})
    assert data['pending'] == 0 and data['items'][0]['processedReason'] == 'status-change'
    assert data['items'][0]['statusChange']['from'] == 'Открыт'
    store.processed('inbox', ['QA-1'], False, 'alice')
    store.observe('inbox', [{**issue(1), '_statusId': '2', 'fields': {'status': 'В работе'},
                             '_statusChanges': [{'at': data['items'][0]['processedAt'], 'from': 'Открыт', 'to': 'В работе'}]}])
    assert api.widget_data('inbox', {})['pending'] == 1

def test_status_change_outside_filter_and_round_trip_history(dashboard):
    from datetime import timedelta
    data = {**issue(1), '_statusId': '1', 'fields': {'status': 'Открыт'}}
    store.observe('inbox', [data])
    state = store.read();entry = state['queues']['inbox']['entries']['QA-1']
    entry['firstSeenAt'] = (datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat();store.write(state)
    event = {'at': (datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat(), 'from': 'В работе', 'to': 'Открыт'}
    store.observe('inbox', [], retained=[{**data, '_statusChanges': [event]}])
    result = api.widget_data('inbox', {})
    assert result['pending'] == 0 and result['items'][0]['inFilter'] is False
    assert result['items'][0]['statusChange'] == event

def test_status_rename_and_edits_before_first_seen_do_not_process(dashboard):
    store.observe('inbox', [{**issue(1), '_statusId':'1', 'fields':{'status':'Open'}}])
    store.observe('inbox', [{**issue(1), '_statusId':'1', 'fields':{'status':'Открыт'}}])
    assert api.widget_data('inbox', {})['pending'] == 1
    store.observe('inbox', [{**issue(2), '_statusId':'2', 'fields':{'status':'В работе'},
                            '_statusChanges':[{'at':'2020-01-01T00:00:00Z','from':'Открыт','to':'В работе'}]}])
    assert api.widget_data('inbox', {})['pending'] == 2

def test_old_chart_and_sizes_migrate_without_rewriting_queue(dashboard):
    store.observe('inbox', [issue(1)])
    store.processed('inbox', ['QA-1'], True, 'alice')
    data = store.read()
    data['widgets'].append({'id': 'old-chart', 'title': 'График', 'jql': 'project = QA', 'kind': 'donut', 'size': 'XXL'})
    store.write(data)
    before = store.FILE.read_bytes()
    widgets = api.get_dashboard({})['widgets']
    chart = widgets[1]
    assert (chart['kind'], chart['presentation'], chart['size'], chart['w'], chart['h']) == ('view', 'donut', 'XXL', api.GRID_COLUMNS, 12)
    assert store.FILE.read_bytes() == before
    assert api.widget_data('inbox', {})['items'][0]['processedBy'] == 'alice'

def test_geometry_and_palette_survive_save_and_processed_history(dashboard, monkeypatch):
    monkeypatch.setenv('DASHBOARD_EDITORS', 'alice')
    store.observe('inbox', [issue(1)])
    store.processed('inbox', ['QA-1'], True, 'alice')
    widget = api.Widget(**{**dashboard, 'kind': 'view', 'x': 3, 'y': 8, 'w': 7, 'h': 9, 'palette': 'ocean', 'colors': {'Open': '#00aacc'}})
    result = api.save_layout(api.Layout(version=1, widgets=[widget]), {'login': 'alice'})
    assert result['widgets'][0]['x'] == 3 and result['widgets'][0]['h'] == 9
    assert store.read()['widgets'][0]['colors'] == {'Open': '#00aacc'}
    assert api.widget_data('inbox', {})['pending'] == 0
    assert len(store.read()['queues']['inbox']['entries']['QA-1']['history']) == 1

def test_overlapping_cards_and_css_values_are_rejected(dashboard, monkeypatch):
    from pydantic import ValidationError
    monkeypatch.setenv('DASHBOARD_EDITORS', 'alice')
    with pytest.raises(ValidationError): api.Widget(**{**dashboard, 'x': 127, 'w': 4})
    with pytest.raises(ValidationError): api.Widget(**{**dashboard, 'colors': {'Open': 'url(https://example.test)'}})
    cards = [api.Widget(**{**dashboard, 'x': 0, 'y': 0}), api.Widget(**{**dashboard, 'id': 'another', 'x': 2, 'y': 1})]
    with pytest.raises(HTTPException) as error: api.save_layout(api.Layout(version=1, widgets=cards), {'login': 'alice'})
    assert error.value.status_code == 422
    assert store.read()['version'] == 1

def test_counter_always_s_and_legacy_positions_repair_without_losing_queue(dashboard):
    widget = api.Widget(**{**dashboard, 'size': 'XL', 'w': 10, 'h': 12})
    assert (widget.size, widget.w, widget.h) == ('S', 4, 4)
    store.observe('inbox', [issue(1)])
    data = store.read()
    data['widgets'][0].update(size='XL', x=127, y=0, w=3, h=12)
    store.write(data)
    result = api.get_dashboard({})['widgets'][0]
    assert (result['size'], result['x'], result['w'], result['h']) == ('S', api.GRID_COLUMNS - 4, 4, 4)
    assert api.widget_data('inbox', {})['pending'] == 1

def test_image_size_presets_and_legacy_shape_migration():
    for name, dimensions in [('S', (4, 4)), ('M', (8, 8)), ('L', (16, 8)), ('XL', (24, 12))]:
        widget = api.Widget(title='Список', jql='project=QA', size=name)
        assert (widget.w, widget.h) == dimensions
    full = api.Widget(title='Полная ширина', jql='project=QA', size='XXL', x=17)
    assert full.fullWidth and (full.x, full.w, full.h) == (0, api.GRID_COLUMNS, 12)
    old = api.Widget.model_validate({'title':'Старый M','jql':'project=QA','size':'M','w':4,'h':6})
    assert (old.w, old.h, old.gridVersion) == (8, 8, 2)
    custom = api.Widget.model_validate({'title':'Свои размеры','jql':'project=QA','size':'M','w':7,'h':9,'gridVersion':2})
    assert (custom.w, custom.h) == (7, 9)


def _jira_stub(monkeypatch, light, detail):
    """light/detail: key → raw. Возвращает журнал вызовов (fields каждого запроса)."""
    calls = []
    monkeypatch.setattr(api, 'SessionLocal', lambda: nullcontext(None))
    monkeypatch.setattr(api.jira, '_load_cfg', lambda db: {'base_url': 'https://jira.test'})
    def search(cfg, jql, limit=0, fields='*navigable', expand=''):
        calls.append(('search', fields))
        rows = list((light if fields == api.LIGHT_FIELDS else detail).values())
        return rows, len(rows)
    def by_keys(cfg, keys, fields='*navigable', expand=''):
        calls.append(('keys', fields, tuple(keys)))
        source = light if fields == api.LIGHT_FIELDS else detail
        return [source[k] for k in keys if k in source]
    monkeypatch.setattr(api.jira, '_search', search)
    monkeypatch.setattr(api.jira, '_by_keys', by_keys)
    return calls


def _raw(n, updated, status=('1', 'Открыт'), summary=None):
    return {'key': f'QA-{n}', 'fields': {'summary': summary or f'Задача {n}', 'updated': updated,
                                       'status': {'id': status[0], 'name': status[1]}}}


def _light(n, updated, status=('1', 'Открыт')):
    return {'key': f'QA-{n}', 'fields': {'updated': updated, 'status': {'id': status[0], 'name': status[1]}}}


def test_light_poll_fetches_details_only_for_changed_issues(dashboard, monkeypatch):
    detail = {'QA-1': _raw(1, 't1'), 'QA-2': _raw(2, 't1')}
    calls = _jira_stub(monkeypatch, {}, detail)
    api.refresh('inbox')                                   # первый опрос — полная выборка
    assert len(calls) == 1 and calls[0][0] == 'search' and calls[0][1].startswith('*navigable')
    queue = store.read()['queues']['inbox']
    assert queue['fullSyncAt'] and queue['entries']['QA-1']['jiraUpdated'] == 't1'

    calls.clear()
    detail['QA-2'] = _raw(2, 't2', summary='Переименованная')
    light = {'QA-1': _light(1, 't1'), 'QA-2': _light(2, 't2'), 'QA-3': _light(3, 't1')}
    detail['QA-3'] = _raw(3, 't1')
    calls[:] = []
    monkeypatch.setattr(api.jira, '_search', lambda cfg, jql, limit=0, fields='', expand='': (calls.append(('search', fields)) or (list(light.values()), 3)))
    api.refresh('inbox')
    assert calls[0] == ('search', api.LIGHT_FIELDS)
    assert calls[1][0] == 'keys' and calls[1][1].startswith('*navigable') and calls[1][2] == ('QA-2', 'QA-3')      # QA-1 не менялась — не догружается
    items = {i['key']: i for i in api.widget_data('inbox', {})['items']}
    assert items['QA-1']['fields']['summary'] == 'Задача 1'
    assert items['QA-2']['fields']['summary'] == 'Переименованная'
    assert set(items) == {'QA-1', 'QA-2', 'QA-3'} and all(i['inFilter'] for i in items.values())


def test_light_poll_still_auto_processes_status_change(dashboard, monkeypatch):
    detail = {'QA-1': _raw(1, 't1')}
    _jira_stub(monkeypatch, {}, detail)
    api.refresh('inbox')
    assert api.widget_data('inbox', {})['pending'] == 1
    detail['QA-1'] = _raw(1, 't2', status=('2', 'В работе'))
    _jira_stub(monkeypatch, {'QA-1': _light(1, 't2', ('2', 'В работе'))}, detail)
    api.refresh('inbox')
    data = api.widget_data('inbox', {})
    assert data['pending'] == 0 and data['items'][0]['processedReason'] == 'status-change'


def test_full_sync_returns_after_interval_or_column_change(dashboard, monkeypatch):
    calls = _jira_stub(monkeypatch, {'QA-1': _light(1, 't1')}, {'QA-1': _raw(1, 't1')})
    api.refresh('inbox')
    calls.clear(); api.refresh('inbox')
    assert calls[0] == ('search', api.LIGHT_FIELDS)
    state = store.read()
    state['queues']['inbox']['fullSyncAt'] = '2000-01-01T00:00:00+00:00'; store.write(state)
    calls.clear(); api.refresh('inbox')
    assert calls[0][1].startswith('*navigable')
    widget = api.Widget(**{**dashboard, 'columns': ['summary', 'customfield_9']})
    store.layout([widget.model_dump()], store.read()['version'])
    calls.clear(); api.refresh('inbox')
    assert calls[0][0] == 'search' and 'customfield_9' in calls[0][1]


def test_light_poll_keeps_retained_issue_that_left_filter(dashboard, monkeypatch):
    _jira_stub(monkeypatch, {}, {'QA-1': _raw(1, 't1')})
    api.refresh('inbox')
    calls = _jira_stub(monkeypatch, {'QA-1': _light(1, 't1')}, {'QA-1': _raw(1, 't1')})
    monkeypatch.setattr(api.jira, '_search', lambda cfg, jql, limit=0, fields='', expand='': (calls.append(('search', fields)) or ([], 0)))
    api.refresh('inbox')
    assert ('keys', api.LIGHT_FIELDS, ('QA-1',)) in calls
    assert not any(c[0] == 'keys' and c[1] != api.LIGHT_FIELDS for c in calls)   # не менялась — без догрузки
    item = api.widget_data('inbox', {})['items'][0]
    assert item['fields']['summary'] == 'Задача 1' and item['inFilter'] is False



def test_personal_widgets_are_private_and_survive_other_saves(dashboard, monkeypatch):
    monkeypatch.setenv('DASHBOARD_EDITORS', 'alice')
    bob = {'login': 'bob'}; carol = {'login': 'carol'}; alice = {'login': 'alice'}
    mine = api.Widget(id='bob-1', title='Мои баги', jql='assignee = bob', scope='personal', owner='someone-else')
    v = api.save_layout(api.Layout(version=1, widgets=[api.Widget(**dashboard), mine]), bob)
    stored = next(w for w in store.read()['widgets'] if w['id'] == 'bob-1')
    assert stored['owner'] == 'bob'                                     # владелец — тот, кто сохранил
    assert {w['id'] for w in v['widgets']} == {'inbox', 'bob-1'}
    assert [w['id'] for w in api.get_dashboard(carol)['widgets']] == ['inbox']
    with pytest.raises(HTTPException): api.widget_data('bob-1', carol)
    store.observe('bob-1', [issue(1)])
    with pytest.raises(HTTPException): api.mark_processed('bob-1', api.Mark(keys=['QA-1']), carol)
    # Редактор меняет общие — личный виджет bob остаётся.
    api.save_layout(api.Layout(version=store.read()['version'], widgets=[api.Widget(**{**dashboard, 'title': 'Новое'})]), alice)
    assert {w['id'] for w in store.read()['widgets']} == {'inbox', 'bob-1'}
    assert api.widget_data('bob-1', bob)['pending'] == 1


def test_several_widgets_with_same_jql_are_independent(dashboard, monkeypatch):
    monkeypatch.setenv('DASHBOARD_EDITORS', 'alice')
    alice = {'login': 'alice'}
    twin = api.Widget(id='inbox-2', title='Та же очередь', jql=dashboard['jql'], kind='counter')
    view = api.Widget(id='list-same', title='Тот же JQL списком', jql=dashboard['jql'])
    saved = api.save_layout(api.Layout(version=1, widgets=[api.Widget(**dashboard), twin, view]), alice)
    assert [w['id'] for w in saved['widgets']] == ['inbox', 'inbox-2', 'list-same']
    for wid in ('inbox', 'inbox-2', 'list-same'):
        store.observe(wid, [issue(1), issue(2)])
    api.mark_processed('inbox', api.Mark(keys=['QA-1']), alice)
    assert api.widget_data('inbox', alice)['pending'] == 1
    assert api.widget_data('inbox-2', alice)['pending'] == 2          # отметка в одном счётчике не трогает другой
    assert len(api.widget_data('list-same', alice)['items']) == 2


def test_only_ether_owner_can_reply(dashboard, monkeypatch, tmp_path):
    from db import ether_credentials
    from agents import ether_mcp
    monkeypatch.setattr(ether_credentials, '_OWNER', tmp_path / 'owner.json')
    monkeypatch.setattr(api, 'MOCK', False)
    monkeypatch.setattr(ether_mcp, 'configured', lambda: True)
    sent = []
    monkeypatch.setattr(ether_mcp, 'send_message', lambda peer, text: sent.append((peer, text)) or {'sent': True})
    ether_credentials.set_owner('alice')
    with pytest.raises(HTTPException) as exc:
        api.ether_send(api.EtherSend(peer={'id': 1}, text='привет'), {'login': 'bob'})
    assert exc.value.status_code == 403 and sent == []
    assert api.ether_send(api.EtherSend(peer={'id': 1}, text='привет'), {'login': 'alice'}) == {'sent': True}
    monkeypatch.setattr(ether_mcp, 'get_thread', lambda peer: {'messages': [], 'canSend': True})
    assert api.ether_thread(api.EtherPeer(peer={'id': 1}), {'login': 'bob'})['canSend'] is False


def test_counter_color_and_thresholds_are_validated_and_sorted():
    w = api.Widget(title='Очередь', jql='project = QA', kind='counter', counterColor='#112233',
                   thresholds=[{'from': 10, 'color': '#ff0000'}, {'from': '3', 'color': '#ffaa00'}, {'from': 10, 'color': '#990000'}])
    assert w.thresholds == [{'from': 3, 'color': '#ffaa00'}, {'from': 10, 'color': '#990000'}]
    for bad in ({'counterColor': 'red'}, {'thresholds': [{'from': 0, 'color': '#ff0000'}]}, {'thresholds': [{'from': 5, 'color': 'red'}]}):
        with pytest.raises(ValueError): api.Widget(title='Очередь', jql='project = QA', kind='counter', **bad)
