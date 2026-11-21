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
    with pytest.raises(HTTPException) as exc:api.save_layout(api.Layout(version=1,widgets=[]),{'login':'bob','role':'superuser'})
    assert exc.value.status_code==403
    assert api.save_layout(api.Layout(version=1,widgets=[api.Widget(**dashboard)]),{'login':'alice'})['version']==2
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
