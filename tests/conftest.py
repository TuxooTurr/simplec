"""Общее для всех тестов."""

import pytest

import db.requirements_store as rs


@pytest.fixture(autouse=True)
def _no_base_requirement_tree(tmp_path, monkeypatch):
    """Базовое дерево «Данных» (147 папок) в тестах не дописывается — иначе оно попадёт в чужие проверки папок.
    Тест самого дописывания подставляет свой базовый файл."""
    monkeypatch.setattr(rs, "_FOLDERS_DEFAULT", tmp_path / "нет_базового_дерева.json")
