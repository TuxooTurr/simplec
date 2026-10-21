"""Резервная копия: выгрузка без секретов, восстановление с сохранёнными секретами, разделы, снимок перед заменой."""

import json
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.api.backup as bk
from db.metrics_models import Base, MetricsSettings
from db.metrics_models import TestSystem as Systems   # «Test…» pytest принял бы за тест


@pytest.fixture
def env(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setattr(bk, "DATA_DIR", data)
    monkeypatch.setattr(bk, "BACKUPS_DIR", data / "backups")
    monkeypatch.setattr(bk, "_ROOT", tmp_path)
    monkeypatch.setattr(bk, "_etalons_dump", lambda: ({"test_cases": {"ids": ["t1"], "documents": ["кейс"], "metadatas": [{}], "embeddings": []}}, ""))
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    (data / "people.json").write_text(json.dumps({"people": [{"id": "p1", "name": "Иванов"}]}, ensure_ascii=False), "utf-8")
    (data / "testdata_connections.json").write_text(json.dumps([
        {"id": "c1", "name": "Стенд", "host": "db1", "password": "s3cret"},
        {"id": "c2", "name": "Пустой", "host": "db2", "password": ""}]), "utf-8")
    (data / "model_bench_scenarios.json").write_text(json.dumps([{"id": "s1", "max_tokens": 1000}]), "utf-8")
    (data / "new_store.json").write_text(json.dumps({"x": 1}), "utf-8")          # новое хранилище — попадает само
    db.add_all([MetricsSettings(key="jira_base_url", value="https://jira.example"),
                MetricsSettings(key="jira_token", value="PAT-123"),
                MetricsSettings(key="custom_llm_providers", value=json.dumps([{"id": "groq", "api_key": "gsk_1", "model": "llama"}])),
                MetricsSettings(key="confluence_token_path", value="/home/me/token.txt"),
                Systems(it_service_ci="CI001", name="ОД", mon_system_ci="CI002", started_at=datetime(2026, 10, 1, 9, 30))])
    db.commit()
    yield db, data
    db.close()


def test_выгрузка_всего_без_секретов(env):
    db, _ = env
    b = bk.export("all", db=db)
    assert b["format"] == bk.FORMAT and b["secrets"] == "excluded"
    files = b["server"]["files"]
    assert set(files) == {"people.json", "testdata_connections.json", "model_bench_scenarios.json", "new_store.json"}
    assert files["testdata_connections.json"][0]["password"] == bk.REDACTED and files["testdata_connections.json"][1]["password"] == ""
    assert files["model_bench_scenarios.json"][0]["max_tokens"] == 1000           # счётчик токенов — не секрет
    settings = {r["key"]: r["value"] for r in b["server"]["tables"]["metrics_settings"]}
    assert settings["jira_token"] == bk.REDACTED and settings["jira_base_url"] == "https://jira.example"
    assert json.loads(settings["custom_llm_providers"])[0] == {"id": "groq", "api_key": bk.REDACTED, "model": "llama"}
    assert settings["confluence_token_path"] == "/home/me/token.txt"                # путь к файлу с токеном переносим
    assert "s3cret" not in json.dumps(b, ensure_ascii=False) and "PAT-123" not in json.dumps(b) and "gsk_1" not in json.dumps(b)
    titles = {s["id"] for s in b["summary"]}
    assert {"bugs", "test_data", "model_bench", "settings", "etalons"} <= titles


def test_выгрузка_одного_раздела(env):
    db, _ = env
    b = bk.export("bugs", db=db)
    assert set(b["server"]["files"]) == {"people.json"}
    assert {r["key"] for r in b["server"]["tables"]["metrics_settings"]} == {"jira_base_url", "jira_token"}
    assert "etalons" not in b["server"]
    with pytest.raises(HTTPException):
        bk.export("нет-такого", db=db)


def test_восстановление_после_переустановки_и_на_том_же_месте(env, tmp_path):
    db, data = env
    backup = bk.export("all", db=db)
    backup = json.loads(json.dumps(backup))                                          # как через файл
    # «Переустановка»: файлов нет, настройки пустые.
    for p in data.glob("*.json"):
        p.unlink()
    db.query(MetricsSettings).delete(); db.query(Systems).delete(); db.commit()
    restored = []
    import db.vector_store as vsmod                                                    # эталоны — без настоящей Chroma

    class FakeCol:
        def upsert(self, **kw): restored.append(kw)

    class FakeVS:
        ef = None
        class client:
            @staticmethod
            def get_or_create_collection(name, embedding_function=None): return FakeCol()
    vsmod_orig = vsmod.VectorStore
    vsmod.VectorStore = FakeVS
    try:
        r = bk.import_backup(bk.ImportBody(backup=backup), db=db)
    finally:
        vsmod.VectorStore = vsmod_orig
    assert not r["errors"] and r["snapshot"].startswith("data/backups/before-restore-")
    people = json.loads((data / "people.json").read_text("utf-8"))
    assert people["people"][0]["name"] == "Иванов"
    conns = json.loads((data / "testdata_connections.json").read_text("utf-8"))
    assert conns[0]["password"] == "" and conns[0]["host"] == "db1"                  # секрета негде взять — пусто, вводят заново
    s = {m.key: m.value for m in db.query(MetricsSettings).all()}
    assert s["jira_token"] == "" and s["jira_base_url"] == "https://jira.example"
    assert db.query(Systems).one().started_at == datetime(2026, 10, 1, 9, 30)   # таблица и даты восстановлены
    assert restored == [{"ids": ["t1"], "documents": ["кейс"]}]                       # пустые метаданные в Chroma не передаём

    # Тот же SimpleTest, секреты введены заново, восстановили ещё раз — секреты на месте.
    conns[0]["password"] = "new"
    (data / "testdata_connections.json").write_text(json.dumps(conns), "utf-8")
    db.query(MetricsSettings).filter_by(key="jira_token").update({"value": "PAT-NEW"}); db.commit()
    bk.import_backup(bk.ImportBody(backup=backup, sections=["test_data", "bugs"]), db=db)
    assert json.loads((data / "testdata_connections.json").read_text("utf-8"))[0]["password"] == "new"
    assert db.query(MetricsSettings).filter_by(key="jira_token").one().value == "PAT-NEW"


def test_выбранные_разделы_и_снимок(env):
    db, data = env
    backup = json.loads(json.dumps(bk.export("all", db=db)))
    (data / "people.json").write_text('{"people": []}', "utf-8")
    (data / "model_bench_scenarios.json").write_text("[]", "utf-8")
    r = bk.import_backup(bk.ImportBody(backup=backup, sections=["model_bench"]), db=db)
    assert r["restored"]["files"] == ["model_bench_scenarios.json"]
    assert json.loads((data / "people.json").read_text("utf-8")) == {"people": []}    # раздел не выбран — не тронут
    snap = json.loads((data.parent / r["snapshot"]).read_text("utf-8"))
    assert snap["secrets"] == "included" and snap["server"]["files"]["people.json"] == {"people": []}
    for _ in range(7):
        bk._snapshot(db)
    assert len(list((data / "backups").glob("before-restore-*.json"))) <= bk.KEEP_SNAPSHOTS


def test_чужой_или_битый_файл(env):
    db, _ = env
    with pytest.raises(HTTPException):
        bk.import_backup(bk.ImportBody(backup={"format": "other"}), db=db)
    with pytest.raises(HTTPException):
        bk.import_backup(bk.ImportBody(backup={"format": bk.FORMAT, "version": 99, "server": {}}), db=db)
    r = bk.restore(db, {"files": {"../evil.json": {}, "x.txt": {}}})
    assert len(r["errors"]) == 2 and not r["restored"]["files"]


def test_redact_и_unredact():
    v = {"a": {"token": "t", "token_path": "/p", "auth_type": "api_key", "n_tokens": 5}, "list": [{"id": 1, "password": "x"}]}
    red = bk.redact(v)
    assert red == {"a": {"token": bk.REDACTED, "token_path": "/p", "auth_type": "api_key", "n_tokens": 5},
                   "list": [{"id": 1, "password": bk.REDACTED}]}
    old = {"a": {"token": "OLD"}, "list": [{"id": 2, "password": "two"}, {"id": 1, "password": "one"}]}
    assert bk.unredact(red, old) == {"a": {"token": "OLD", "token_path": "/p", "auth_type": "api_key", "n_tokens": 5},
                                     "list": [{"id": 1, "password": "one"}]}
