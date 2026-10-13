"""Регистрация дефекта в SBER911: ИТ-услуга и КЭ уходят всегда.

Оба поля заданы процессом проекта и не зависят ни от компонента, ни от чего-либо
ещё. На UI их нет — пользователю нечего выбирать.
"""

import json

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


# ── Jira приняла создание, но поля не записала ───────────────────────────────

class FakeJira:
    """Jira, которая при создании молча игнорирует справочные поля.

    Так ведёт себя реальный инстанс, когда поля нет на экране создания: задача
    заводится «успешно», а ИТ-услуга и КЭ остаются пустыми.
    """

    def __init__(self, accepts=None, edit_ok=True):
        # Форматы, которые принимает редактирование. None = принимает любой.
        self.accepts = accepts
        self.edit_ok = edit_ok
        self.stored: dict = {}
        self.edit_attempts: list = []

    def __call__(self, cfg, method, path, json_body=None, params=None, **kw):
        if method == "POST" and path == "/rest/api/2/issue":
            return {"key": "SBER911-1"}                 # поля игнорируются
        if method == "GET" and path.endswith("/transitions"):
            return {"transitions": [{"name": "В работу"}]}
        if method == "GET" and path.startswith("/rest/api/2/issue/"):
            want = (params or {}).get("fields", "").split(",")
            return {"fields": {f: self.stored.get(f) for f in want if f}}
        if method == "PUT" and path.startswith("/rest/api/2/issue/"):
            fid, value = next(iter(json_body["fields"].items()))
            self.edit_attempts.append((fid, value))
            if not self.edit_ok:
                raise JD.HTTPException(400, "поле недоступно")
            if self.accepts is not None and value != self.accepts:
                raise JD.HTTPException(400, "неверный формат значения")
            self.stored[fid] = value
            return {}
        return {}


@pytest.fixture
def fake_jira(monkeypatch):
    def _make(**kw):
        jira = FakeJira(**kw)
        monkeypatch.setattr(JD, "_jira_request", jira)
        monkeypatch.setattr(JD, "_load_cfg", lambda db: {
            "base_url": "https://jira.example", "token": "t", "token_path": "",
            "ssl_verify": False, "labels": [], "issuetype": "Дефект",
        })
        monkeypatch.setattr(JD, "_resolve_fields",
                            lambda cfg, project, issuetype: _schema("array", IT_SERVICE_FIELD, KE_FIELD))
        return jira
    return _make


def test_поля_дозаполняются_если_создание_их_проглотило(fake_jira):
    """Главный сценарий обращения: дефект создан, а ИТ-услуга и КЭ пустые."""
    jira = fake_jira()
    res = JD.create_defect(_create(["Back-end"]), db=None)

    assert res["key"] == "SBER911-1"
    assert jira.stored[IT_SERVICE_FIELD] == [dict(JC.IT_SERVICE)]
    assert jira.stored[KE_FIELD] == [dict(JC.KE)]
    assert not [w for w in res["warnings"] if "не проставилась" in w]


def test_подбирается_формат_который_jira_принимает(fake_jira):
    """Инстанс ждёт одиночный объект, а не массив — перебор должен дойти до него."""
    jira = fake_jira(accepts=dict(JC.IT_SERVICE))
    JD.create_defect(_create(), db=None)

    assert jira.stored[IT_SERVICE_FIELD] == dict(JC.IT_SERVICE)
    # Первым пробовали массив — значит перебор реально шёл по вариантам
    assert jira.edit_attempts[0][1] == [dict(JC.IT_SERVICE)]


def test_если_поле_недоступно_пользователь_видит_предупреждение(fake_jira):
    """Молчаливая потеря обязательного поля недопустима — говорим прямо."""
    fake_jira(edit_ok=False)
    res = JD.create_defect(_create(), db=None)

    texts = " ".join(res["warnings"])
    assert "ИТ-услуга" in texts and "не проставилась" in texts
    assert "КЭ" in texts
    # Причину не выдумываем: показываем ответ Jira как есть
    assert "ответ Jira: поле недоступно" in texts


def test_без_createmeta_не_утверждаем_что_поля_нет_на_экране(fake_jira, monkeypatch):
    """createmeta у нас 403: есть ли поле на экране, неизвестно — не пишем «отсутствует на экране»."""
    fake_jira(edit_ok=False)
    monkeypatch.setattr(JD, "_resolve_fields", lambda cfg, project, issuetype: {})
    res = JD.create_defect(_create(), db=None)
    texts = " ".join(res["warnings"])
    assert "не проставилась" in texts
    assert "на экране" not in texts and "Jira не приняла значение" in texts


def test_уже_заполненные_поля_не_трогаем(fake_jira):
    jira = fake_jira()
    jira.stored[IT_SERVICE_FIELD] = [dict(JC.IT_SERVICE)]
    jira.stored[KE_FIELD] = [dict(JC.KE)]

    JD.create_defect(_create(), db=None)
    assert jira.edit_attempts == [], "лишние правки уже корректной задачи"


@pytest.mark.parametrize("schema, first", [
    ("array",  [dict(JC.KE)]),
    ("option", dict(JC.KE)),
    ("string", JC.KE["value"]),
    ("",       [dict(JC.KE)]),   # схема неизвестна — начинаем с формы из боевой выгрузки
])
def test_порядок_кандидатов_зависит_от_схемы(schema, first):
    assert JD._reference_candidates(JC.KE, schema)[0] == first


def test_кандидаты_без_дублей():
    for schema in ("array", "option", "string", ""):
        forms = JD._reference_candidates(JC.IT_SERVICE, schema)
        assert len(forms) == len({json.dumps(f, sort_keys=True, ensure_ascii=False) for f in forms})


def test_в_переборе_есть_голый_id_и_название_с_id():
    """Jira Сбера показывает КЭ как «название (id)» — такие формы тоже пробуем, после привычных."""
    forms = JD._reference_candidates(JC.KE, "")
    assert [JC.KE["id"]] in forms and JC.KE["id"] in forms
    assert f"{JC.KE['value']} ({JC.KE['id']})" in forms
    assert forms[0] == [dict(JC.KE)]          # порядок прежних вариантов не изменился


def test_подбирается_форма_название_с_id(fake_jira):
    labelled = [f"{JC.IT_SERVICE['value']} ({JC.IT_SERVICE['id']})"]
    jira = fake_jira(accepts=labelled)
    res = JD.create_defect(_create(), db=None)
    assert jira.stored[IT_SERVICE_FIELD] == labelled
    assert not [w for w in res["warnings"] if "ИТ-услуга" in w]
