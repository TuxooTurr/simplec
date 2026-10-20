"""Справочник людей Jira tool: хранение на бэкенде, проверка направлений и повторов."""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import backend.api.people as api
from db import people_store


@pytest.fixture(autouse=True)
def people_file(monkeypatch, tmp_path):
    monkeypatch.setattr(people_store, "PEOPLE_FILE", tmp_path / "people.json")
    return tmp_path / "people.json"


def test_пустой_справочник_без_файла():
    assert api.get_people() == {"people": [], "updatedAt": ""}


def test_сохранение_и_чтение_переживают_перезапуск(people_file):
    body = api.PeopleBody(people=[
        api.Person(id="p1", name=" Иванов Илья ", role="QA", color="#6366f1", directions=["testing"]),
        api.Person(id="p2", name="Петров", role="BE", directions=["back", "front", "back"]),
    ])
    saved = api.put_people(body)
    assert saved["updatedAt"] and people_file.exists()
    got = api.get_people()["people"]
    assert got[0]["name"] == "Иванов Илья"                     # пробелы по краям убраны
    assert got[1]["directions"] == ["back", "front"]            # повтор направления убран


def test_битый_файл_не_роняет_раздел(people_file):
    people_file.write_text("{битый", "utf-8")
    assert api.get_people()["people"] == []


def test_неизвестное_направление_и_повтор_id_отклоняются():
    with pytest.raises(ValidationError):
        api.Person(id="p1", name="Иванов", directions=["космос"])
    with pytest.raises(HTTPException) as e:
        api.put_people(api.PeopleBody(people=[api.Person(id="p1", name="А"), api.Person(id="p1", name="Б")]))
    assert e.value.status_code == 422
