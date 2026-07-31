"""Регистрация дефекта в SBER911: ИТ-услуга и КЭ уходят всегда.

Оба поля заданы процессом проекта и не зависят ни от компонента, ни от чего-либо
ещё. На UI их нет — пользователю нечего выбирать.
"""

import pytest

import backend.api.jira_constants as JC
from backend.api import jira_defects as JD
from backend.api.jira_defects import _reference_value


IT_SERVICE_FIELD = "customfield_22400"
KE_FIELD = "customfield_18300"


def _schema(field_type: str, *fields: str) -> dict:
    """resolved-структура из createmeta с заданным типом схемы у полей."""
    return {"_by_id": {f: {"schema": {"type": field_type}} for f in fields}}


# ── Константы ────────────────────────────────────────────────────────────────

def test_ит_услуга_совпадает_с_боевым_значением():
    assert JC.IT_SERVICE["id"] == "233293"
    assert JC.IT_SERVICE["value"] == "Платформа Сопровождения Sber911"
    assert JC.IT_SERVICE["statusDetailed"] == "Промышленная эксплуатация"


def test_кэ_совпадает_с_боевым_значением():
    assert JC.KE["id"] == "3521751"
    assert JC.KE["value"] == "Управление приоритетными событиями"
    assert JC.KE["typeSm"] == "Функциональная подсистема"


def test_кэ_ссылается_на_ту_же_ит_услугу():
    """Рассинхрон здесь Jira примет молча, а связь в отчётах развалится."""
    assert JC.KE["itServiceId"] == JC.IT_SERVICE["id"]
    assert JC.KE["itServiceValue"] == JC.IT_SERVICE["value"]


def test_справочника_компонент_кэ_больше_нет():
    """КЭ перестала зависеть от компонента — старый справочник должен был уйти,
    иначе он снова начнёт расходиться с боевым значением."""
    assert not hasattr(JC, "COMPONENT_KE")


# ── Форма значения под схему поля ────────────────────────────────────────────

def test_массив_отдаётся_как_в_выгрузке_реальных_дефектов():
    resolved = _schema("array", IT_SERVICE_FIELD, KE_FIELD)

    it = _reference_value(resolved, IT_SERVICE_FIELD, JC.IT_SERVICE)
    assert it == [{"id": "233293",
                   "value": "Платформа Сопровождения Sber911",
                   "statusDetailed": "Промышленная эксплуатация"}]

    ke = _reference_value(resolved, KE_FIELD, JC.KE)
    assert ke == [{"id": "3521751",
                   "value": "Управление приоритетными событиями",
                   "itServiceId": "233293",
                   "itServiceValue": "Платформа Сопровождения Sber911",
                   "typeSm": "Функциональная подсистема"}]


def test_одиночное_поле_отдаётся_объектом():
    resolved = _schema("option", KE_FIELD)
    assert _reference_value(resolved, KE_FIELD, JC.KE) == JC.KE


def test_строковое_поле_отдаётся_значением():
    resolved = _schema("string", KE_FIELD)
    assert _reference_value(resolved, KE_FIELD, JC.KE) == "Управление приоритетными событиями"


def test_без_createmeta_отдаём_строкой():
    """Схемы нет — Jira на SBER911 в этом случае требовала строку."""
    assert _reference_value({}, KE_FIELD, JC.KE) == "Управление приоритетными событиями"
    assert _reference_value({}, IT_SERVICE_FIELD, JC.IT_SERVICE) == "Платформа Сопровождения Sber911"


def test_значение_не_портится_между_вызовами():
    """Отдаём копию: иначе правка ответа на месте испортила бы константу
    для всех последующих дефектов в этом процессе."""
    resolved = _schema("array", KE_FIELD)
    first = _reference_value(resolved, KE_FIELD, JC.KE)
    first[0]["value"] = "испорчено"

    second = _reference_value(resolved, KE_FIELD, JC.KE)
    assert second[0]["value"] == "Управление приоритетными событиями"
    assert JC.KE["value"] == "Управление приоритетными событиями"


# ── Что реально уходит в Jira ────────────────────────────────────────────────

@pytest.fixture
def captured_payload(monkeypatch):
    """Подменяет сеть и настройки: возвращает поля, ушедшие в POST /issue."""
    sent: dict = {}

    def fake_request(cfg, method, path, json_body=None, **kw):
        if path == "/rest/api/2/issue":
            sent.update(json_body["fields"])
            return {"key": "SBER911-1"}
        return {}

    monkeypatch.setattr(JD, "_jira_request", fake_request)
    monkeypatch.setattr(JD, "_load_cfg", lambda db: {
        "base_url": "https://jira.example", "token": "t", "token_path": "",
        "ssl_verify": False, "labels": [], "issuetype": "Дефект",
    })
    # Схема как в реальной выгрузке: оба поля — массивы объектов
    monkeypatch.setattr(JD, "_resolve_fields", lambda cfg, project, issuetype: _schema(
        "array", IT_SERVICE_FIELD, KE_FIELD))
    return sent


def _create(components=None, **extra):
    return JD.CreateDefectBody(
        project="SBER911", summary="Тестовый дефект",
        components=components or [], **extra,
    )


@pytest.mark.parametrize("components", [
    [],                      # компонент не выбран
    ["Back-end"],
    ["iOS"],                 # раньше сюда подставлялась другая КЭ
    ["iOS", "Android"],
    ["Неизвестный компонент"],   # раньше КЭ не уходила вовсе
])
def test_ит_услуга_и_кэ_уходят_при_любом_компоненте(captured_payload, components):
    JD.create_defect(_create(components), db=None)

    assert captured_payload[IT_SERVICE_FIELD] == [dict(JC.IT_SERVICE)], (
        f"ИТ-услуга не ушла при компонентах {components}"
    )
    assert captured_payload[KE_FIELD] == [dict(JC.KE)], (
        f"КЭ не ушла при компонентах {components}"
    )


def test_кэ_извне_не_переопределяет_значение_проекта(captured_payload):
    """Поле ke в запросе осталось для других проектов, но SBER911 им не управляют."""
    JD.create_defect(_create(["Back-end"], ke="Что-то своё"), db=None)
    assert captured_payload[KE_FIELD] == [dict(JC.KE)]


def test_на_чужом_проекте_фиксированные_значения_не_навязываются(captured_payload):
    body = JD.CreateDefectBody(project="OTHER", summary="Дефект")
    JD.create_defect(body, db=None)
    assert IT_SERVICE_FIELD not in captured_payload
    assert KE_FIELD not in captured_payload
