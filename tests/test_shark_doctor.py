import asyncio
import json
import os
from contextlib import asynccontextmanager
from types import SimpleNamespace
import pytest
from scripts import shark_doctor as doctor


def test_init_template_never_overwrites_and_permissions(tmp_path):
    target=tmp_path/'config.env'
    doctor.initialize_env(target)
    original=target.read_text()
    assert target.stat().st_mode & 0o777 == 0o600
    assert 'LOGS_MCP_PROFILE=pvs' in original
    with pytest.raises(FileExistsError):doctor.initialize_env(target)
    assert target.read_text()==original


def test_schema_export_omits_defaults_examples_and_free_text(tmp_path):
    async def scenario():
        class Client:
            async def list_tools(self):
                return SimpleNamespace(tools=[SimpleNamespace(name='SearchIndexTool',annotations=None,input_schema={
                    'type':'object','properties':{'password':{'type':'string','default':'private-password'},
                    'query_dsl':{'type':'object','description':'Cookie: private-cookie','examples':['private-example']}},'required':['query_dsl']})],next_cursor=None)
        await doctor.export_contract(Client(),tmp_path/'tools.json')
    asyncio.run(scenario())
    text=(tmp_path/'tools.json').read_text()
    assert 'private-' not in text
    assert json.loads(text)['tools'][0]['input_schema']['required']==['query_dsl']
    assert (tmp_path/'tools.json').stat().st_mode & 0o777 == 0o600


def test_demo_never_counts_as_live_acceptance(monkeypatch):
    monkeypatch.setenv('SHARK_MOCK','1')
    checks=[];asyncio.run(doctor.probe('pvs',checks))
    assert checks[0]['status']=='missing'
    assert not any(c['status']=='pass' for c in checks)


def test_live_error_does_not_echo_remote_secret(monkeypatch):
    from agents import logs_mcp
    monkeypatch.setenv('SHARK_MOCK','0');monkeypatch.setenv('LOGS_MCP_PROFILE','pvs')
    @asynccontextmanager
    async def failing():
        raise RuntimeError('Cookie: private-cookie; password=private-password')
        yield
    monkeypatch.setattr(logs_mcp,'open_source',failing)
    checks=[];asyncio.run(doctor.probe('pvs',checks))
    assert checks[0]['status']=='missing'
    assert 'private-' not in json.dumps(checks)


def test_offline_report_never_contains_configuration_values(monkeypatch,tmp_path,capsys):
    monkeypatch.setattr(doctor,'load_environment',lambda *a:None)
    monkeypatch.setattr(doctor.subprocess,'run',lambda *a,**k:SimpleNamespace(stdout='v20.20.0'))
    monkeypatch.setenv('OPENSEARCH_PASSWORD','private-password')
    monkeypatch.setenv('ETHER_MCP_HEADERS','Cookie: private-cookie')
    monkeypatch.setenv('OPENSEARCH_URL','https://private-user:private-token@host.invalid:19200')
    monkeypatch.setenv('SHARK_DATA_DIR',str(tmp_path/'data'))
    report=tmp_path/'report.json'
    doctor.main(['--report',str(report)])
    output=capsys.readouterr().out+report.read_text()
    assert 'private-' not in output
    assert json.loads(report.read_text())['corporateAcceptanceComplete'] is False
    assert report.stat().st_mode & 0o777 == 0o600


def test_software_only_does_not_probe_network(monkeypatch):
    monkeypatch.setattr(doctor,'load_environment',lambda *a:None)
    monkeypatch.setattr(doctor,'offline_checks',lambda **k:[{'check':'software','status':'pass','message':'ok'}])
    async def forbidden(*args,**kwargs):raise AssertionError('Network probe must be explicit')
    monkeypatch.setattr(doctor,'probe',forbidden)
    assert doctor.main(['--software-only'])==0


def test_invalid_pvs_url_is_a_report_item_not_exception(monkeypatch,tmp_path):
    monkeypatch.setenv('OPENSEARCH_URL','https://[invalid')
    monkeypatch.setenv('SHARK_DATA_DIR',str(tmp_path/'data'))
    checks=doctor.offline_checks()
    assert next(c for c in checks if c['check']=='pvs_api_host')['status']=='missing'


def test_contract_keeps_properties_named_like_metadata():
    source = {'type':'object','description':'private-description','properties':{'title':{'type':'string','default':'private-default'},'description':{'type':'string','description':'private-free-text'}}}
    result = doctor.sanitized_schema(source)
    assert result['properties'] == {'title':{'type':'string'},'description':{'type':'string'}}
    assert 'private-' not in json.dumps(result)


def test_source_output_is_suppressed_but_cli_output_recovers(capfd):
    with doctor.silence_source_output():
        os.write(1, b'private-log-message')
        os.write(2, b'private-cookie')
    os.write(1, b'public-status')
    output=capfd.readouterr()
    assert 'private-' not in output.out+output.err
    assert 'public-status' in output.out
