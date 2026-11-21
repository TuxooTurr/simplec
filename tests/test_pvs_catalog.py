import asyncio
import json
from types import SimpleNamespace
import pytest
from agents import logs_mcp as mcp
from db import log_catalog

def test_catalog_scoped_and_ttl(tmp_path,monkeypatch):
    monkeypatch.setattr(log_catalog,'FILE',tmp_path/'services.json')
    monkeypatch.setenv('LOGS_PVS_INDEX','sber-app-*')
    log_catalog.save(['b','a','a'])
    assert log_catalog.load()['services']==['a','b'] and log_catalog.fresh(log_catalog.load())
    monkeypatch.setenv('LOGS_PVS_INDEX','other-*')
    assert log_catalog.load()=={}

def test_discovery_uses_namespace_and_actual_mapping(monkeypatch):
    source=object.__new__(mcp.PvsLogSource)
    source.client=object();source.tool=object();source.fields={'namespace':'k8s.namespace.name.keyword','service':'service.name.keyword','timestamp':'timestamp'}
    source.namespace='sber911-sigma-back';source.index='sber-app-*';source.dsl_as_string=True;source.format_supported=True
    async def search(client,tool,args,**kwargs):
        dsl=json.loads(args['query_dsl'])
        assert dsl['aggs']['services']['terms']['field']=='service.name.keyword'
        assert dsl['query']['bool']['filter'][0]=={'term':{'k8s.namespace.name.keyword':'sber911-sigma-back'}}
        assert 'timestamp' in dsl['query']['bool']['filter'][1]['range']
        return {'aggregations':{'services':{'buckets':[{'key':'sigma-back'}]}}}
    monkeypatch.setattr(mcp,'_call_search',search)
    assert asyncio.run(mcp.discover_services(source))==['sigma-back']

def test_incomplete_catalog_is_not_accepted(monkeypatch):
    source=object.__new__(mcp.PvsLogSource)
    source.client=object();source.tool=object();source.fields={'namespace':'ns','service':'svc','timestamp':'timestamp'}
    source.namespace='ns';source.index='logs';source.dsl_as_string=False;source.format_supported=False
    async def search(*args,**kwargs):return {'timed_out':True,'aggregations':{'services':{'buckets':[]}}}
    monkeypatch.setattr(mcp,'_call_search',search)
    with pytest.raises(mcp.LogSourceError):asyncio.run(mcp.discover_services(source))
