"""Проверка пресета ТКС: сгенерированные строки должны совпадать по форме
с реальными строками таблиц tcs / tcsmember."""

import random

import pytest

from agents.datagen_executor import plan_action
from agents.datagen_presets import (
    JAZZ_URL, PRESET_TCS, TCS_LABELS, TEST_MARKER, get_preset,
    tcs_external_rules, tcs_jazz_rules, tcsmember_rules,
)
from agents.datagen_sql import build_insert, rows_to_params
from agents.datagen_values import build_row, ensure_marker_present

RND = lambda: random.Random(20260729)


def test_jazz_профиль_повторяет_форму_боевых_строк():
    """В данных: type='jazz' → external_id=-1, url=ссылка Jazz, cnt=0."""
    row = build_row(tcs_jazz_rules(), index=0, rnd=RND())
    assert row["type"] == "jazz"
    assert row["external_id"] == -1
    assert row["url"] == JAZZ_URL
    assert row["cnt"] == 0
    assert row["external"] is False
    assert row["parent_id"] is None
    assert row["number"] is None


def test_внешний_профиль_повторяет_форму_боевых_строк():
    """В данных: type='tcs' → url пуст, external_id — реальный номер."""
    row = build_row(tcs_external_rules(), index=0, rnd=RND())
    assert row["type"] == "tcs"
    assert row["url"] is None
    assert row["external_id"] >= 900_001      # тестовый диапазон
    assert row["label"] in TCS_LABELS


def test_nm_повторяет_external_id_как_в_боевых_строках():
    """В данных nm начинается с того же номера: '3117 - Сервисы ...'."""
    rnd = RND()
    for i in range(10):
        row = build_row(tcs_external_rules(), index=i, rnd=rnd)
        assert f"{row['external_id']} - " in row["nm"], (row["external_id"], row["nm"])


def test_external_id_не_пересекается_с_боевыми():
    """Боевые external_id в данных трёх-пятизначные (115, 3117, 77139).
    Тестовые берём заведомо выше, чтобы не столкнуться."""
    rnd = RND()
    ids = [build_row(tcs_external_rules(), index=i, rnd=rnd)["external_id"] for i in range(50)]
    assert min(ids) >= 900_001
    assert all(i > 121212 for i in ids)       # максимум из показанных боевых


def test_метка_есть_в_каждом_профиле():
    """Без метки строку не отличить от боевой и не удалить за собой."""
    for rules in (tcs_jazz_rules(), tcs_external_rules(), tcsmember_rules()):
        assert ensure_marker_present(rules, TEST_MARKER)


def test_метка_попадает_в_nm():
    row = build_row(tcs_jazz_rules(), index=0, rnd=RND())
    assert row["nm"].startswith(TEST_MARKER)
    assert "ВКС по инциденту" in row["nm"]


def test_id_и_даты_не_задаются_генератором():
    """id — автоинкремент; cnt_update_date и last_jazz_union_date в боевых
    строках чаще всего NULL, их проставляет приложение."""
    for rules in (tcs_jazz_rules(), tcs_external_rules()):
        assert "id" not in rules
        assert "cnt_update_date" not in rules
        assert "last_jazz_union_date" not in rules


def test_участники_ссылаются_на_родителя_колонкой_tcs():
    rows = plan_action(
        {"table": "tcsmember", "count": 3, "rules": tcsmember_rules()},
        parent_values={"tcs": 4374}, marker=TEST_MARKER, rnd=RND(),
    )
    assert len(rows) == 3
    assert all(r["tcs"] == 4374 for r in rows)
    assert [r["name"] for r in rows] == [
        f"{TEST_MARKER} Участник-1", f"{TEST_MARKER} Участник-2", f"{TEST_MARKER} Участник-3"]


def test_связь_задана_явно_потому_что_fk_не_объявлен():
    """В структуре tcsmember внешний ключ на tcs не объявлен, поэтому
    интроспекция его не найдёт — связь описана в пресете."""
    link = PRESET_TCS["link"]
    assert link == {"parent": "tcs", "child": "tcsmember",
                    "child_column": "tcs", "parent_column": "id"}


def test_собирается_корректный_insert():
    rows = plan_action(PRESET_TCS["actions"][0], marker=TEST_MARKER, rnd=RND())
    columns = sorted(rows[0])
    sql = build_insert("tcs", columns)
    assert sql.startswith('INSERT INTO "tcs" (')
    assert sql.count("?") == len(columns)
    assert len(rows_to_params(rows, columns)[0]) == len(columns)


def test_все_действия_пресета_планируются_без_ошибок():
    for action in PRESET_TCS["actions"]:
        parent = {"tcs": 1} if action["table"] == "tcsmember" else None
        rows = plan_action(action, parent_values=parent, marker=TEST_MARKER, rnd=RND())
        assert len(rows) == action["count"]


def test_пресет_находится_по_идентификатору():
    assert get_preset("tcs") is PRESET_TCS
    assert get_preset("нет такого") is None
