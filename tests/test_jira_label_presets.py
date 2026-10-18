"""Пресеты лейблов дефектов: добавленный при создании лейбл сохраняется в общий список навсегда."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.api.jira_defects as jd
from db.metrics_models import MetricsSettings


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    MetricsSettings.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def test_новый_лейбл_дописывается_к_пресетам_навсегда(db):
    before = jd._load_cfg(db)["labels"]
    r = jd.add_label_presets(jd.LabelPresetsBody(labels=["Регресс 26", "  "]), db=db)
    assert r["labels"] == [*before, "Регресс_26"]
    assert jd._load_cfg(db)["labels"] == r["labels"]                 # сохранено в настройках


def test_повтор_без_учёта_регистра_не_дублируется(db):
    jd.add_label_presets(jd.LabelPresetsBody(labels=["ПРМ-2"]), db=db)
    r = jd.add_label_presets(jd.LabelPresetsBody(labels=["прм-2", "фокус911"]), db=db)
    assert [l.lower() for l in r["labels"]].count("прм-2") == 1
    assert [l.lower() for l in r["labels"]].count("фокус911") == 1    # «Фокус911» уже в списке по умолчанию


def test_остальные_настройки_не_трогает(db):
    jd._set(db, jd._K_URL, "https://jira.example"); db.commit()
    jd.add_label_presets(jd.LabelPresetsBody(labels=["Новый"]), db=db)
    assert jd._load_cfg(db)["base_url"] == "https://jira.example"
