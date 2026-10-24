"""Генератор инцидентов: сборка сообщений Sber ESM, отправка, инструкции SQL-шаблоном, импорт файлов ноутбука."""

import asyncio
import io
import json
import random
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException, UploadFile

import db.incident_gen_store as store
from backend.api import incident_gen as ig


@pytest.fixture(autouse=True)
def data_file(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_FILE", tmp_path / "incident_gen.json")


def _spec(**kw) -> ig.Spec:
    return ig.Spec(cis=[ig.Ci(code="CI00233293", name="Карточка")], **kw)


LIB = [{"id": "1", "system": "Касса", "description": "Отклонение метрики", "summary": "кратко", "instruction": "# Шаги"}]


def test_план_основные_и_дополнительные_со_сдвигом():
    items = ig.plan(_spec(main_count=2, extra_min=1, extra_max=3, extra_spread_min=10), [], random.Random(1))
    main = [i for i in items if i["main"]]
    extra = [i for i in items if not i["main"]]
    assert len(main) == 2 and 1 <= len(extra) <= 3
    assert all(i["shift"] == 0 for i in main) and all(-10 <= i["shift"] <= -1 for i in extra)
    with pytest.raises(HTTPException):
        ig.plan(_spec(main_count=0), [])
    with pytest.raises(HTTPException):
        ig.plan(_spec(description_mode="library"), [])
    with pytest.raises(HTTPException):
        ig.plan(ig.Spec(cis=[ig.Ci(code=f"CI{i}") for i in range(60)], main_count=10), [])


def test_сообщение_подстановки_время_и_настройки():
    now = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)
    settings = {"assignee_id_bhb": "", "assignee_personal_number": "77", "system_created_by": "CI02587203"}
    item = {"ci": "CI00233293", "system": "Карточка", "main": True, "lib": None, "shift": 0}
    b = ig.build(_spec(description="Тест {n}: {system} ({ci}) {inc} {json}", priority="HIGH"), settings, item, 3, now)
    m = b["message"]
    assert m["description"] == f"Тест 3: Карточка (CI00233293) {m['businessId']} {{json}}"
    assert m["title"] == m["description"] and m["priorityCode"] == "HIGH" and m["itService"]["code"] == "CI00233293"
    assert m["createdAt"] == "2026-10-24T11:58:00.000000000Z" and m["targetDate"] == "2026-10-26T12:00:00.000000000Z"
    assert m["assignee"] == {"idBhb": None, "personalNumber": "77", "idEps": None} and m["systemCreatedBy"] == "CI02587203"
    extra = ig.build(_spec(title="Заголовок {ci}"), settings, {**item, "main": False, "shift": -5}, 1, now)
    assert extra["message"]["createdAt"] == "2026-10-24T11:53:00.000000000Z" and extra["message"]["title"] == "Заголовок CI00233293"
    assert extra["instruction"] == ""                                 # инструкции — только основным


def test_описание_и_инструкция_из_библиотеки_парой():
    item = {"ci": "CI1", "system": "CI1", "main": True, "lib": LIB[0], "shift": 0}
    b = ig.build(_spec(description_mode="library", instruction_mode="library"), {}, item, 1)
    assert (b["message"]["description"], b["instruction"], b["summary"]) == ("Отклонение метрики", "# Шаги", "кратко")


def test_sql_шаблон_как_в_ноутбуке_но_с_экранированием():
    sql = ig.render_sql("SELECT f({incident_sm_id}, {incident_instruction}, {system_cis}, {user_id}, {unknown}, {seq})",
                        {"incident_sm_id": "INC1", "incident_instruction": "it's", "system_cis": ["CI1", "CI2"],
                         "user_id": 5, "seq": "nextval('s')"})
    assert sql == "SELECT f('INC1', 'it''s', ('CI1', 'CI2'), 5, NULL, nextval('s'))"


class FakeFuture:
    def __init__(self, n, fail=False):
        self.n, self.fail = n, fail

    def get(self, timeout=None):
        if self.fail:
            raise RuntimeError("broker down")
        return type("M", (), {"offset": 100 + self.n, "partition": 0})()


class FakeProducer:
    sent: list = []

    def send(self, topic, value, key, partition=None):
        FakeProducer.sent.append((topic, json.loads(value), key, partition))
        return FakeFuture(len(FakeProducer.sent), fail=len(FakeProducer.sent) == 2)

    def flush(self, timeout=None):
        pass

    def close(self, timeout=None):
        pass


def test_отправка_ключи_ошибки_и_инструкции_с_повтором(monkeypatch):
    from agents.kafka_client import KafkaClient
    FakeProducer.sent = []
    monkeypatch.setattr(KafkaClient, "_build_producer", staticmethod(lambda cfg: FakeProducer()))
    monkeypatch.setattr(ig, "kafka_cfg", lambda s: {})
    calls = []

    def run_sql(cfg, sql):
        calls.append(sql)
        return [] if len(calls) == 1 else [(555,)]          # первый раз инцидента ещё нет в БД
    monkeypatch.setattr(ig, "_run_sql", run_sql)
    monkeypatch.setattr(ig.time, "sleep", lambda s: None)
    from db.testdata_connections import TestDataConnectionsStore
    monkeypatch.setattr(TestDataConnectionsStore, "get_connection", classmethod(lambda cls, i: {"id": i}))
    store.update(lambda d: d["settings"].update(instruction_sql="SELECT ins({incident_sm_id}, {incident_instruction})",
                                                db_connection_id="db1"))
    store.update(lambda d: d["library"].extend(LIB))

    run = asyncio.run(ig.send(ig.SendBody(spec=_spec(main_count=3, instruction_mode="library"), preset="Все данные")))
    keys = [k for *_, k, _ in FakeProducer.sent]
    assert len(set(keys)) == 3 and all(k.startswith(b"111") for k in keys)
    assert {t for t, *_ in FakeProducer.sent} == {"repl.sber_esm_input"}
    ok = [r for r in run["results"] if not r.get("error")]
    assert len(ok) == 2 and run["results"][1]["error"].startswith("RuntimeError")
    assert [r.get("instruction_id") for r in ok] == ["555", "555"]
    assert len(calls) == 3 and "'# Шаги'" in calls[-1]
    assert ig.history()["history"][0]["preset"] == "Все данные"


def test_без_sql_шаблона_инциденты_уходят_без_инструкций(monkeypatch):
    from agents.kafka_client import KafkaClient
    FakeProducer.sent = []
    monkeypatch.setattr(KafkaClient, "_build_producer", staticmethod(lambda cfg: FakeProducer()))
    monkeypatch.setattr(ig, "kafka_cfg", lambda s: {})
    run = asyncio.run(ig.send(ig.SendBody(spec=_spec(instruction_mode="text", instruction="Шаг 1"))))
    assert run["results"][0]["offset"] == 101
    assert "нет SQL-шаблона" in run["results"][0]["instruction_error"]
    assert ig.get_state()["instructionsBlocked"].startswith("нет SQL-шаблона")


def _upload(obj) -> UploadFile:
    return UploadFile(file=io.BytesIO(json.dumps(obj, ensure_ascii=False).encode()), filename="x.json")


def test_контакты_из_описаний_убираются():
    raw = ("Наименование услуги: Касса (CI1)\r\nМенеджер ИТ-услуги: Иванова И. А. (046956)\nМестный тел.: 8-55733054\n"
           "Сотовый тел.: 79162455438\nНазначено группе: ДИТ (Канин К.Г.)\nОбратился: Любаев Е. Г.\n"
           "Описание: группа хостов (Гуреев С. Н.), пишите a.b@sber.ru или +7 916 245-54-38; Иванов Иван Иванович")
    assert ig.scrub(raw) == ("Наименование услуги: Касса (CI1)\nОбратился: [сотрудник]\n"
                             "Описание: группа хостов ([сотрудник]), пишите [почта] или [телефон]; [сотрудник]")


def test_импорт_примеров_сценариев_и_sql():
    ex = {"incident_instruction": [{"incident_description": "Отклонение", "instruction": "# И", "system_name": "Касса",
                                    "user_name": "Иванов Иван", "user_personal_number": "123"},
                                   {"incident_description": "Отклонение"}]}
    assert asyncio.run(ig.import_file(_upload(ex))) == {"kind": "library", "added": 1}
    item = ig.get_state()["library"][0]
    assert item["instruction"] == "# И" and "Иванов" not in json.dumps(item, ensure_ascii=False)
    sc = {"all": {"name": "Все данные", "actions": ["incident", "additional_incident", "instruction"], "systems": ["CI1"]},
          "min": {"name": "Только инцидент", "actions": ["incident"], "systems": ["CI2"]}}
    assert asyncio.run(ig.import_file(_upload(sc))) == {"kind": "presets", "added": 2}
    p = {x["name"]: x["spec"] for x in ig.get_state()["presets"]}
    assert (p["Все данные"]["extra_max"], p["Все данные"]["instruction_mode"]) == (5, "library")
    assert (p["Только инцидент"]["extra_max"], p["Только инцидент"]["instruction_mode"]) == (0, "none")
    assert asyncio.run(ig.import_file(_upload({"create_incident_instruction": "SELECT 1"}))) == {"kind": "sql", "added": 1}
    assert ig.get_state()["instructionsBlocked"] == "не выбрано подключение к БД инцидентов"
    with pytest.raises(HTTPException):
        asyncio.run(ig.import_file(_upload({"x": 1})))
