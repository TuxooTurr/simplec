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
    assert api.get_people() == {"people": [], "jiraFields": {}, "updatedAt": ""}


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


def test_имя_в_jira_и_поля_направлений_хранятся_раздельно():
    api.put_jira_fields(api.JiraFieldsBody(fields={"testing": " customfield_1 ", "analytics": "", "back": "customfield_2"}))
    api.put_people(api.PeopleBody(people=[api.Person(id="p1", name="Илья", jiraName=" ivanov-ia ", jiraDisplay="Иванов Илья")]))
    got = api.get_people()
    assert got["people"][0]["jiraName"] == "ivanov-ia"
    # Сохранение людей не стирает поля направлений, пустое поле направления не хранится.
    assert got["jiraFields"] == {"testing": "customfield_1", "back": "customfield_2"}
    api.put_jira_fields(api.JiraFieldsBody(fields={"design": "customfield_3"}))
    assert api.get_people()["people"][0]["name"] == "Илья"


def test_поле_jira_неизвестного_направления_отклоняется():
    with pytest.raises(ValidationError):
        api.JiraFieldsBody(fields={"qa": "customfield_1"})
