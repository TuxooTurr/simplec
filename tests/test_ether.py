import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
import pytest
from agents import ether_mcp as mcp, ether_login as login
from db import ether_credentials as creds
from webconnect import secrets

@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(creds,'_FILE',tmp_path/'session.json')
    monkeypatch.setattr(secrets,'_KEY_FILE',tmp_path/'key')
    monkeypatch.delenv('SIMPLETEST_SECRET_KEY',raising=False)
    monkeypatch.delenv('ETHER_MCP_HEADERS',raising=False)
    monkeypatch.setattr(mcp,'MOCK',False)
    mcp.reset_caches()

def test_encrypted_storage_and_sources():
    assert mcp.credential_source()=='none'
    creds.save('session=private-value')
    assert 'private-value' not in creds._FILE.read_text()
    assert creds._FILE.stat().st_mode & 0o777 == 0o600
    assert creds.load()=='session=private-value'
    assert mcp.credential_source()=='cookie'
    creds._FILE.write_text('{}')
    assert mcp.credential_source()=='broken'
    assert mcp.configured()  # A damaged store is an error, not an unconfigured empty feed.

def test_cookie_beats_env_and_headers(monkeypatch):
    monkeypatch.setenv('ETHER_MCP_HEADERS','Cookie: from-env\nX-Test: yes')
    assert mcp.auth_headers()=={'Cookie':'from-env','X-Test':'yes'}
    creds.save('session=saved')
    assert mcp.auth_headers()=={'Cookie':'session=saved'}

def test_author_filters_and_confidential_content():
    assert mcp.match_author('Иванов Иван',['иванов'])
    assert mcp.match_author('Иванов',['Иванов Иван'])
    assert not mcp.match_author('Яковлев Ян',['Я'])
    assert mcp.match_author('Я',['Я'])
    assert 'secret' not in mcp.message_text({'text':'secret','confidential_hidden':True})
    assert 'report.txt' in mcp.message_text({'document':{'file_name':'report.txt','text':'result'}})

def test_feed_filter_cache_and_rolling_budget(monkeypatch):
    calls=[]
    @asynccontextmanager
    async def client(*args):yield object()
    monkeypatch.setattr(mcp,'open_client',client)
    now=datetime.now(timezone.utc).isoformat()
    async def call(client,name,args):
        calls.append((name,args))
        if name=='chat_get_dialogs': return {'dialogs':[{'peer':{'id':i},'last_message_date':str(i)} for i in range(25)]}
        return {'messages':[{'mid':str(args['peer']['id']),'sender':{'name':'Иванов Иван'},'date':now,'text':'ok'},
                            {'mid':'no','sender':{'name':'Другой'},'date':now,'text':'private'}]}
    monkeypatch.setattr(mcp,'_call',call)
    monkeypatch.setenv('ETHER_BUDGET','8')
    first=mcp.fetch_feed(['Иванов'])
    second=mcp.fetch_feed(['Иванов'])
    # Repeated polls share the same dialog-cache cycle; they do not spend another 8 calls.
    third=mcp.fetch_feed(['Иванов'])
    assert len(first)==len(second)==len(third)==8
    assert sum(name=='chat_get_dialogs' for name,_ in calls)==1
    assert sum(name=='chat_get_messages' for name,_ in calls)==8
    assert all(m['author']=='Иванов Иван' for m in third)

def test_cookie_scope_and_cancel_clear_session(monkeypatch):
    monkeypatch.setattr(mcp,'reset_caches',lambda:None)
    cookies=[{'name':'a','value':'1','domain':'.sber.ru'},{'name':'b','value':'2','domain':'efir.sber.ru'},
             {'name':'evil','value':'3','domain':'evil-sber.ru'}]
    assert login.cookie_header(cookies)=='a=1; b=2'
    creds.save('a=1');login.cancel()
    assert creds.load() is None and login.state()['state']=='idle'

def test_browser_override_must_exist(monkeypatch,tmp_path):
    browser=tmp_path/'SberBrowser';browser.touch()
    monkeypatch.setenv('MCP_WEB_BROWSER_PATH',str(browser))
    assert login.find_browser()==str(browser)
    monkeypatch.setenv('MCP_WEB_BROWSER_PATH',str(tmp_path/'absent'))
    with pytest.raises(RuntimeError):login.find_browser()

def test_tool_error_does_not_echo_private_response():
    async def scenario():
        class Client:
            async def list_tools(self):return SimpleNamespace(tools=[SimpleNamespace(name='chat_get_spaces',annotations=None,input_schema={'properties':{}})])
            async def call_tool(self,*args):return SimpleNamespace(is_error=True,content=[SimpleNamespace(text='Cookie=private')])
        with pytest.raises(mcp.EtherMcpError) as exc:await mcp._call(Client(),'chat_get_spaces',{})
        assert 'private' not in str(exc.value)
    asyncio.run(scenario())


def test_recovery_only_terminates_marked_exact_profile(tmp_path,monkeypatch):
    import os, subprocess, signal
    from types import SimpleNamespace
    profile=tmp_path/'profile';profile.mkdir();(profile/'.shark-ether-profile').touch()
    lines=f'111 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={profile}\n222 /Applications/SberBrowser.app/Contents/MacOS/SberBrowser --user-data-dir={profile}-other\n333 /Applications/SberBrowser.app/Contents/MacOS/SberBrowser --user-data-dir=/normal/profile'
    monkeypatch.setattr(subprocess,'run',lambda *a,**k:SimpleNamespace(stdout=lines))
    killed=[];monkeypatch.setattr(os,'kill',lambda pid,sig:killed.append((pid,sig)))
    login._kill_leftovers(profile)
    assert killed==[(111,signal.SIGTERM)]
    (profile/'.shark-ether-profile').unlink();killed.clear();login._kill_leftovers(profile)
    assert killed==[]


def test_dialog_time_orders_nested_messages_and_timezones():
    old={'last_message':{'date':'2026-11-21T10:00:00+03:00'}}
    fresh={'last_activity':'2026-11-21T08:00:00Z'}
    assert mcp.dialog_time(fresh)>mcp.dialog_time(old)
    assert mcp.dialog_time({'last_message':{'timestamp':1795248000000}}).tzinfo is not None

def test_tools_are_found_on_later_page():
    async def scenario():
        calls=[]
        class Client:
            async def list_tools(self,cursor=None):
                calls.append(cursor)
                return SimpleNamespace(tools=[] if not cursor else [SimpleNamespace(name='chat_get_spaces',annotations=None,input_schema={'properties':{}})],next_cursor='page-two' if not cursor else None)
            async def call_tool(self,*args):return SimpleNamespace(is_error=False,structured_content={'spaces':[]})
        assert await mcp._call(Client(),'chat_get_spaces',{})=={'spaces':[]}
        assert calls==[None,'page-two']
    asyncio.run(scenario())

def test_account_rolling_budget_cannot_be_exceeded(monkeypatch):
    from collections import deque
    budget=deque();clock=[1000]
    monkeypatch.setattr(mcp.time,'monotonic',lambda:clock[0])
    assert all(mcp._available(budget,20) for _ in range(20))
    assert not mcp._available(budget,20)
    clock[0]+=61
    assert mcp._available(budget,20)

def test_tracking_accepts_keywords_without_author_and_combines_with_or():
    assert mcp.matches_tracking(['Другой'], 'Ошибка на ИФТ', [], ['ошибка'])
    assert mcp.matches_tracking(['Иванов Иван'], 'готово', ['Иванов'], ['нет такого'])
    assert not mcp.matches_tracking(['Другой'], 'готово', ['Иванов'], ['ошибка'])

def test_chat_keywords_use_same_mcp_and_preserve_confidentiality(monkeypatch):
    @asynccontextmanager
    async def client(*args): yield object()
    monkeypatch.setattr(mcp, 'open_client', client)
    now = datetime.now(timezone.utc).isoformat()
    async def call(client, name, args):
        if name == 'chat_get_dialogs': return {'dialogs': [{'peer': 'qa', 'name': 'QA'}]}
        return {'messages': [{'id': 1, 'sender_name': 'Другой', 'date': now, 'text': 'Ошибка релиза'},
                             {'id': 2, 'sender_name': 'Другой', 'date': now, 'text': 'Ошибка private', 'confidential_hidden': True}]}
    monkeypatch.setattr(mcp, '_call', call)
    messages = mcp.fetch_feed([], ['ошибка'])
    assert len(messages) == 1 and messages[0]['text'] == 'Ошибка релиза'

def test_mail_and_meetings_use_advertised_read_tools_and_shared_raw_cache(monkeypatch):
    calls = []
    now = datetime.now(timezone.utc).isoformat()
    class Client:
        async def list_tools(self, cursor=None):
            return SimpleNamespace(tools=[SimpleNamespace(name=name, annotations=SimpleNamespace(read_only_hint=True),
                input_schema={'properties': {'limit': {}, 'start': {}, 'end': {}}}) for name in ('mail_get_messages', 'calendar_get_events')])
        async def call_tool(self, name, args):
            calls.append((name, args))
            rows = [{'id': 1, 'date': now, 'start': now, 'subject': 'Релиз ИФТ', 'title': 'Релиз ИФТ', 'body': 'ok', 'sender': {'name': 'Иванов', 'email': 'qa@example.test'}, 'organizer': {'name': 'Иванов'}},
                    {'id': 2, 'date': now, 'start': now, 'subject': 'Другое', 'title': 'Другое', 'body': 'ok', 'sender': {'name': 'Петров'}, 'organizer': {'name': 'Петров'}}]
            return SimpleNamespace(is_error=False, structured_content={'items': rows})
    @asynccontextmanager
    async def client(*args): yield Client()
    monkeypatch.setattr(mcp, 'open_client', client)
    mail = mcp.fetch_channel('mail', [], ['ИФТ'])
    assert len(mail['messages']) == 1 and mail['available']
    assert mcp.fetch_channel('mail', ['Петров'], [])['messages'][0]['author'] == 'Петров'
    assert mcp.fetch_channel('mail', ['qa@example.test'], [])['messages'][0]['author'] == 'Иванов'
    assert mcp.fetch_channel('meetings', ['Иванов'], [])['messages'][0]['title'] == 'Релиз ИФТ'
    assert [name for name, _ in calls] == ['mail_get_messages', 'calendar_get_events']
    assert all(set(args) == {'limit', 'start', 'end'} for _, args in calls)
    assert '_people' not in mail['messages'][0]

@pytest.mark.parametrize('name,readonly', [('mail_delete_messages', False), ('mail_get_messages', False), ('mail_get_messages', None)])
def test_unavailable_or_unsafe_channel_never_calls_tool(monkeypatch, name, readonly):
    class Client:
        async def list_tools(self, cursor=None):
            return SimpleNamespace(tools=[SimpleNamespace(name=name, annotations=SimpleNamespace(read_only_hint=readonly), input_schema={})])
        async def call_tool(self, *args): pytest.fail('Unsafe tool was called')
    @asynccontextmanager
    async def client(*args): yield Client()
    monkeypatch.setattr(mcp, 'open_client', client)
    result = mcp.fetch_channel('mail', [], ['релиз'])
    assert result['available'] is False and result['messages'] == []

def test_all_three_mock_channels_have_independent_filters(monkeypatch):
    monkeypatch.setattr(mcp, 'MOCK', True)
    for channel in ('chat', 'mail', 'meetings'):
        result = mcp.fetch_channel(channel, [], ['релиз'])
        assert result['available'] and result['demo'] and result['messages']
        assert not mcp.fetch_channel(channel, [], ['невстречающееся слово'])['messages']

def test_budget_does_not_starve_later_dialogs(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(mcp.time, 'monotonic', lambda: clock[0])
    @asynccontextmanager
    async def client(*args): yield object()
    monkeypatch.setattr(mcp, 'open_client', client)
    now = datetime.now(timezone.utc).isoformat()
    async def call(client, name, args):
        if name == 'chat_get_dialogs': return {'dialogs': [{'peer': n, 'name': str(n)} for n in range(25)]}
        return {'messages': [{'id': args['peer'], 'sender_name': 'Иванов', 'date': now, 'text': 'ok'}]}
    monkeypatch.setattr(mcp, '_call', call)
    seen = set()
    for _ in range(4):
        seen.update(message['id'] for message in mcp.fetch_feed(['Иванов']))
        clock[0] += 61
    assert len(seen) == 25
