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
        def get(self, **kw): return {"ids": []}
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

    # Тот же Loom, секреты введены заново, восстановили ещё раз — секреты на месте.
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



def test_рисунки_данных_в_копии_и_восстановлении(env):
    import base64
    db, data = env
    folder = data / "requirement_assets"
    folder.mkdir()
    png = b"\x89PNG\r\n\x1a\nrisunok"
    (folder / "0123456789abcdef0123.png").write_bytes(png)
    (folder / "junk.txt").write_text("не рисунок")
    out = bk.collect(db, "etalons")
    assert out["assets"] == {"0123456789abcdef0123.png": base64.b64encode(png).decode()}
    assert [s["assets"] for s in bk.summary(out) if s["id"] == "etalons"] == [1]
    assert "assets" not in bk.collect(db, "zephyr")
    (folder / "0123456789abcdef0123.png").unlink()
    out["assets"]["../evil.png"] = base64.b64encode(b"x").decode()
    res = bk.restore(db, out, {"etalons"})
    assert (folder / "0123456789abcdef0123.png").read_bytes() == png
    assert res["restored"]["assets"] == ["0123456789abcdef0123.png"] and any("evil" in e for e in res["errors"])


# ── «Данные»: дерево и документы сливаются, а не затираются ─────────────────

BASE_TREE = [{"id": "b1", "name": "Карточка", "parent_id": ""}, {"id": "b2", "name": "Адреса", "parent_id": "b1"},
             {"id": "b3", "name": "Права", "parent_id": "b1"}]


def test_восстановление_данных_не_затирает_дерево(env):
    db, data = env
    (data / "requirement_folders.json").write_text(json.dumps(BASE_TREE, ensure_ascii=False), "utf-8")
    (data / "requirements.json").write_text(json.dumps([
        {"id": "d0", "name": "Свой", "folder_id": "b3", "updated_at": "2026-10-25"}], ensure_ascii=False), "utf-8")
    # Копия с другой машины: та же «Карточка/Адреса» под другими id, своя папка и документы в них.
    server = {"files": {
        "requirement_folders.json": [{"id": "x1", "name": "карточка ", "parent_id": ""},
                                     {"id": "x2", "name": "Адреса", "parent_id": "x1"},
                                     {"id": "x9", "name": "Старая СТ", "parent_id": "x1"}],
        "requirements.json": [{"id": "d1", "name": "Док", "folder_id": "x2", "updated_at": "2026-10-01"},
                              {"id": "d2", "name": "Док 2", "folder_id": "x9", "updated_at": "2026-10-01"},
                              {"id": "d0", "name": "Свой (старый)", "folder_id": "x9", "updated_at": "2026-09-01"}],
        "requirement_folders_seeded.json": ["/Карточка"],
    }, "tables": {}}
    res = bk.restore(db, server, {"etalons"})
    assert res["errors"] == []
    folders = json.loads((data / "requirement_folders.json").read_text("utf-8"))
    assert [f["id"] for f in folders] == ["b1", "b2", "b3", "x9"]          # базовое дерево цело, дописана одна папка
    assert next(f for f in folders if f["id"] == "x9")["parent_id"] == "b1"
    docs = {d["id"]: d for d in json.loads((data / "requirements.json").read_text("utf-8"))}
    assert docs["d1"]["folder_id"] == "b2" and docs["d2"]["folder_id"] == "x9"   # папки копии → здешние
    assert docs["d0"]["name"] == "Свой" and docs["d0"]["folder_id"] == "b3"     # свежее здешнее не откатилось
    assert json.loads((data / "requirement_folders_seeded.json").read_text("utf-8")) == ["/Карточка"]


def test_merge_сохраняет_документ_даже_если_копия_новее(env):
    db, data = env
    (data / "requirement_folders.json").write_text(json.dumps(BASE_TREE, ensure_ascii=False), "utf-8")
    (data / "requirements.json").write_text(json.dumps([
        {"id": "d0", "name": "Было", "folder_id": "b3", "updated_at": "2026-10-01"}], ensure_ascii=False), "utf-8")
    bk.restore(db, {"files": {"requirements.json": [{"id": "d0", "name": "Стало", "folder_id": "", "updated_at": "2026-10-20"}]},
                    "tables": {}}, None)
    doc = json.loads((data / "requirements.json").read_text("utf-8"))[0]
    assert doc["name"] == "Было" and doc["folder_id"] == "b3"
    assert len(json.loads((data / "requirement_folders.json").read_text("utf-8"))) == 3


def test_сбой_одной_таблицы_не_обрывает_восстановление(env):
    db, data = env
    server = {"files": {"people.json": {"people": []}},
              "tables": {"test_systems": [{"id": 1, "name": None, "it_service_ci": None}]}}   # NOT NULL — упадёт
    res = bk.restore(db, server, None, mode="replace")
    assert "people.json" in res["restored"]["files"]
    assert any("test_systems" in e for e in res["errors"])
    assert db.query(Systems).count() == 1                                     # таблица откатилась целиком


def test_merge_adds_missing_json_settings_and_is_idempotent(env):
    db, data = env
    server = {'files': {'people.json': {'people': [{'id': 'p1', 'name': 'Из копии', 'role': 'QA'}, {'id': 'p2', 'name': 'Новый'}]},
                         'testdata_connections.json': [{'id': 'c1', 'host': 'other', 'password': bk.REDACTED}, {'id': 'c3', 'host': 'new'}]},
              'tables': {'metrics_settings': [{'id': 99, 'key': 'jira_base_url', 'value': 'other'},
                                               {'id': 1, 'key': 'new_setting', 'value': 'added'},
                                               {'key': 'custom_llm_providers', 'value': json.dumps([{'id': 'groq', 'model': 'other', 'api_key': bk.REDACTED}, {'id': 'new', 'api_key': bk.REDACTED}])}]}}
    for _ in range(2): assert not bk.restore(db, server)['errors']
    people = json.loads((data / 'people.json').read_text())['people']
    assert people == [{'id': 'p1', 'name': 'Иванов', 'role': 'QA'}, {'id': 'p2', 'name': 'Новый'}]
    conns = json.loads((data / 'testdata_connections.json').read_text())
    assert len(conns) == 3 and conns[0]['host'] == 'db1' and conns[0]['password'] == 's3cret'
    settings = {row.key: row.value for row in db.query(MetricsSettings)}
    assert settings['jira_base_url'] == 'https://jira.example' and settings['new_setting'] == 'added'
    assert json.loads(settings['custom_llm_providers']) == [{'id': 'groq', 'model': 'llama', 'api_key': 'gsk_1'}, {'id': 'new', 'api_key': ''}]


def test_replace_overwrites_represented_stores_and_keeps_other_sections(env):
    db, data = env
    result = bk.restore(db, {'files': {'people.json': {'people': [{'id': 'p2'}]},
                                      'requirements.json': [{'id': 'new', 'name': 'Из копии', 'folder_id': ''}]},
                             'tables': {'metrics_settings': [{'key': 'jira_base_url', 'value': 'new'}]}},
                        {'bugs', 'etalons'}, mode='replace')
    assert not result['errors']
    assert json.loads((data / 'people.json').read_text()) == {'people': [{'id': 'p2'}]}
    assert json.loads((data / 'requirements.json').read_text())[0]['name'] == 'Из копии'
    assert db.query(MetricsSettings).filter_by(key='jira_base_url').one().value == 'new'
    assert (data / 'testdata_connections.json').exists()


def test_dashboard_roundtrip_counts_merge_marks_and_replacement(env):
    db, data = env
    from backend.api.dashboard import Widget
    current = Widget(id='counter', title='Мой счётчик', jql='project = QA', kind='counter', x=0, y=0).model_dump()
    entry = {'issue': {'key': 'QA-1', 'fields': {}}, 'firstSeenAt': '2026-11-22T00:00:00Z', 'processedAt': 'now', 'processedBy': 'alice'}
    local = {'version': 90, 'widgets': [current], 'queues': {'counter': {'entries': {'QA-1': entry}}}}
    (data / 'dashboard.json').write_text(json.dumps(local))
    exported = bk.export('dashboard', db=db)
    assert exported['server']['files']['dashboard.json'] == local
    assert exported['summary'][0]['counters'] == 1 and exported['summary'][0]['widgets'] == 0
    extra = Widget(id='new', title='Новый список', jql='project = QA', colors={'Открыт': '#abcdef'}, columns=['key', 'st:ms'], stListId='team', x=0, y=0).model_dump()
    incoming = {'version': 1, 'widgets': [{**current, 'title': 'Старое название', 'jql': 'project = OTHER'}, extra],
                'queues': {'counter': {'entries': {'QA-1': {**entry, 'processedAt': None}, 'QA-2': {**entry, 'issue': {'key': 'QA-2', 'fields': {}}}}}}}
    for _ in range(2): assert not bk.restore(db, {'files': {'dashboard.json': incoming}}, {'dashboard'})['errors']
    restored = json.loads((data / 'dashboard.json').read_text())
    assert restored['version'] == 92 and len(restored['widgets']) == 2
    assert restored['widgets'][0] == current
    assert restored['widgets'][1]['y'] >= 4
    assert restored['widgets'][1]['columns'] == ['key', 'st:ms'] and restored['widgets'][1]['colors'] == extra['colors']
    assert restored['queues']['counter']['entries']['QA-1']['processedAt'] == 'now'
    assert set(restored['queues']['counter']['entries']) == {'QA-1', 'QA-2'}
    assert not bk.restore(db, {'files': {'dashboard.json': incoming}}, {'dashboard'}, mode='replace')['errors']
    restored = json.loads((data / 'dashboard.json').read_text())
    assert restored['version'] == 93 and restored['widgets'][0]['title'] == 'Старое название'
    assert restored['queues']['counter']['entries']['QA-1']['processedAt'] is None


def test_merge_database_remaps_ids_and_keeps_relationships(env):
    db, _ = env
    source = {'tables': {
        # Order in the file must not determine foreign-key processing.
        'test_metrics': [{'id': 1, 'test_system_id': 1, 'metric_hash': 'new-metric', 'metric_name': 'M', 'metric_description': '',
                          'metric_type': 'Errors', 'metric_group': 'App', 'metric_unit': 'count', 'object_id': 'obj',
                          'object_name': 'Obj', 'mon_system_metric_id': 'M'}],
        'test_systems': [{'id': 1, 'it_service_ci': 'NEW-CI', 'name': 'Новая система', 'mon_system_ci': 'MON'},
                         {'id': 100, 'it_service_ci': 'CI001', 'name': 'Старое имя', 'mon_system_ci': 'OTHER'}]}}
    for _ in range(2): assert not bk.restore(db, source)['errors']
    assert db.query(Systems).count() == 2
    assert db.query(Systems).filter_by(it_service_ci='CI001').one().name == 'ОД'
    from db.metrics_models import TestMetric
    metric = db.query(TestMetric).one()
    assert metric.system.it_service_ci == 'NEW-CI' and metric.test_system_id != 1


def test_merge_etalons_keeps_existing_ids_and_adds_missing(env, monkeypatch):
    db, _ = env
    import db.vector_store as vsmod
    calls = []
    class Collection:
        def get(self, **kw): return {'ids': ['existing']}
        def upsert(self, **kw): calls.append(kw)
    class FakeVS:
        ef = None
        class client:
            @staticmethod
            def get_or_create_collection(*args, **kwargs): return Collection()
    monkeypatch.setattr(vsmod, 'VectorStore', FakeVS)
    incoming = {'etalons': {'test_cases': {'ids': ['existing', 'new'], 'documents': ['old', 'added']}}}
    assert not bk.restore(db, incoming)['errors']
    assert calls == [{'ids': ['new'], 'documents': ['added']}]
    calls.clear()
    assert not bk.restore(db, incoming, mode='replace')['errors']
    assert calls[0]['ids'] == ['existing', 'new']


def test_corrupt_current_file_is_reported_and_not_overwritten(env):
    db, data = env
    (data / 'people.json').write_text('{invalid')
    result = bk.restore(db, {'files': {'people.json': {'people': []}}})
    assert result['errors'] and (data / 'people.json').read_text() == '{invalid'
    result = bk.restore(db, {'files': {'people.json': {'people': []}}}, mode='replace')
    assert not result['errors'] and json.loads((data / 'people.json').read_text()) == {'people': []}


def test_restore_snapshot_is_private_and_unique(env):
    import stat
    db, data = env
    first, second = bk._snapshot(db), bk._snapshot(db)
    assert first != second
    assert stat.S_IMODE((data.parent / first).stat().st_mode) == 0o600


def test_invalid_dashboard_copy_does_not_replace_current_layout(env):
    db, data = env
    current = {'version': 1, 'widgets': [], 'queues': {}}
    (data / 'dashboard.json').write_text(json.dumps(current))
    result = bk.restore(db, {'files': {'dashboard.json': {'widgets': [{'id': 'bad'}]}}}, mode='replace')
    assert result['errors'] and json.loads((data / 'dashboard.json').read_text()) == current
