import pytest
from backend.api import jira_edit as api
from fastapi import HTTPException

@pytest.fixture
def jira(monkeypatch):
    metas={'QA-1':{'summary':{'name':'Тема','schema':{'type':'string'},'required':True},'priority':{'name':'Приоритет','schema':{'type':'priority'},'allowedValues':[{'id':'1','name':'Высокий'}]}},
           'QA-2':{'summary':{'name':'Тема','schema':{'type':'string'},'required':True}}}
    calls=[]
    monkeypatch.setattr(api.jira,'_load_cfg',lambda db:{})
    monkeypatch.setattr(api.jira,'_by_keys',lambda cfg,keys,**kwargs:[{'key':key,'fields':{'summary':'Тема '+key,'priority':{'id':'1'}}} for key in keys])
    def request(cfg,method,path,json_body=None):
        if method=='GET':return {'fields':metas[path.split('/')[-2]]}
        calls.append((path,json_body));return {}
    monkeypatch.setattr(api.jira,'_jira_request',request)
    return metas,calls

def test_common_fields_are_intersected(jira):
    assert list(api.metadata(api.Keys(keys=['QA-1','QA-2']),None)['fields'])==['summary']

def test_metadata_prefills_current_values_and_marks_mixed_without_writes(jira):
    single = api.metadata(api.Keys(keys=['QA-1']), None)['fields']
    assert single['summary']['value'] == 'Тема QA-1' and single['summary']['primary']
    assert single['priority']['value'] == '1'
    multiple = api.metadata(api.Keys(keys=['QA-1','QA-2']), None)['fields']
    assert multiple['summary']['mixed'] and multiple['summary']['value'] == ''
    assert not jira[1]

def test_each_issue_rechecks_edit_screen_and_reports_partial_success(jira):
    result=api.update(api.Edit(keys=['QA-1','QA-2'],fields={'priority':'1'}),None)
    assert result['done']==1 and result['results'][1]['ok'] is False
    assert jira[1]==[('/rest/api/2/issue/QA-1',{'fields':{'priority':{'id':'1'}}})]

def test_required_field_cannot_be_cleared(jira):
    result=api.update(api.Edit(keys=['QA-1'],fields={'summary':None}),None)
    assert not result['done'] and not jira[1]

def test_disallowed_value_is_not_sent(jira):
    result=api.update(api.Edit(keys=['QA-1'],fields={'priority':'99'}),None)
    assert not result['done'] and not jira[1]

def test_field_types_and_explicit_clear():
    assert api.payload({'schema':{'type':'user'}},'qa')=={'name':'qa'}
    assert api.payload({'schema':{'type':'array','items':'string'}},'one\ntwo')==['one','two']
    assert api.payload({'schema':{'type':'array'}},None)==[]
    assert api.payload({'schema':{'type':'number'}},'1,5')==1.5


def test_background_edit_owner_and_completed_results(jira,monkeypatch):
    import asyncio
    from contextlib import nullcontext
    monkeypatch.setattr(api,'SessionLocal',lambda:nullcontext(None))
    async def scenario():
        started=await api.start_edit(api.Edit(keys=['QA-1','QA-2'],fields={'summary':'Изменено'}),{'login':'alice'})
        with pytest.raises(HTTPException) as error:api.edit_state(started['id'],{'login':'bob'})
        assert error.value.status_code==404
        await api._jobs[started['id']]['task']
        result=api.edit_state(started['id'],{'login':'alice'})
        assert result['status']=='done' and len(result['results'])==result['total']==2
        assert all(item['ok'] for item in result['results'])
    asyncio.run(scenario())
    api._jobs.clear()


@pytest.fixture
def screen(monkeypatch):
    """Экран правки с текстом, метками и эпиком; текущие значения задач — по GET /issue/{key}."""
    meta = {'summary': {'name': 'Тема', 'schema': {'type': 'string'}, 'required': True},
            'labels': {'name': 'Метки', 'schema': {'type': 'array', 'items': 'string'}},
            'priority': {'name': 'Приоритет', 'schema': {'type': 'priority'}, 'allowedValues': [{'id': '1', 'name': 'Высокий'}]},
            api.constants.FIELD_EPIC_LINK: {'name': 'Epic Link', 'schema': {'type': 'any'}}}
    current = {'QA-1': {'summary': 'Вход по смс', 'labels': ['ift-old', 'регресс']},
               'QA-2': {'summary': 'Выход', 'labels': ['ift-old']}}
    puts = []
    monkeypatch.setattr(api.jira, '_load_cfg', lambda db: {})
    def request(cfg, method, path, json_body=None, params=None):
        key = path.split('/')[5]
        if method == 'PUT': puts.append((key, json_body['fields'])); return {}
        if path.endswith('/editmeta'): return {'fields': meta}
        return {'fields': current[key]}
    monkeypatch.setattr(api.jira, '_jira_request', request)
    return puts


def test_replace_fragment_per_issue_in_text_and_labels(screen):
    res = api.update(api.Edit(keys=['QA-1', 'QA-2'], replace={'summary': ['Вход', 'Авторизация'], 'labels': ['ift-old', 'ift']}), None)
    assert res['done'] == 2
    assert screen == [('QA-1', {'summary': 'Авторизация по смс', 'labels': ['ift', 'регресс']}),
                      ('QA-2', {'labels': ['ift']})]                              # «Выход» без «Вход» не трогаем


def test_replace_only_for_text_fields(screen):
    res = api.update(api.Edit(keys=['QA-1'], replace={'priority': ['1', '2']}), None)
    assert not res['done'] and 'текстовых' in res['results'][0]['error'] and not screen


def test_epic_link_is_editable_and_validated(screen):
    assert api.constants.FIELD_EPIC_LINK in api.editable({api.constants.FIELD_EPIC_LINK: {'schema': {'type': 'any'}}})
    assert api.update(api.Edit(keys=['QA-1'], fields={api.constants.FIELD_EPIC_LINK: 'sber911-77'}), None)['done'] == 1
    assert screen[-1] == ('QA-1', {api.constants.FIELD_EPIC_LINK: 'SBER911-77'})
    assert not api.update(api.Edit(keys=['QA-1'], fields={api.constants.FIELD_EPIC_LINK: 'не ключ'}), None)['done']


def test_preview_shows_before_after_and_rejects_non_free_fields(screen, monkeypatch):
    monkeypatch.setattr(api.jira, '_by_keys', lambda cfg, keys, fields='': [
        {'key': 'QA-1', 'fields': {'summary': 'Вход по смс', 'labels': ['ift-old']}},
        {'key': 'QA-2', 'fields': {'summary': 'Выход', 'labels': []}}])
    res = api.preview(api.Preview(keys=['QA-1', 'QA-2'], replace={'summary': ['Вход', 'Авторизация']}), None)
    assert res['affected'] == 1
    assert res['items'][0]['changes'] == [{'field': 'summary', 'name': 'Тема', 'before': 'Вход по смс', 'after': 'Авторизация по смс'}]
    assert res['items'][1]['changes'] == [] and not screen                     # ничего не записано
    with pytest.raises(HTTPException):
        api.preview(api.Preview(keys=['QA-1'], replace={'priority': ['1', '2']}), None)
