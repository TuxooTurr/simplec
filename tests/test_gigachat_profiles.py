"""Три подключения GigaChat: Giga Личный и Giga Corp — по ключу (свой scope), Giga IFT — по сертификату.
Плюс однократный перенос старого единого подключения в новые настройки."""

import sys
import types

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import agents.llm_client as lc
import backend.api.app_settings as AS
from db.metrics_models import MetricsSettings

ENV = ("GIGACHAT_PERS_AUTH_KEY", "GIGACHAT_PERS_MODEL", "GIGACHAT_CORP_AUTH_KEY", "GIGACHAT_CORP_SCOPE",
       "GIGACHAT_CORP_MODEL", "GIGACHAT_MODEL", "GIGACHAT_BASE_URL", "GIGACHAT_CLIENT_CERT_PATH",
       "GIGACHAT_CLIENT_KEY_PATH", "GIGACHAT_AUTH_KEY", "GIGACHAT_AUTH_TYPE", "GIGACHAT_SCOPE", "SSL_MAX_TLS12")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ENV:
        monkeypatch.delenv(k, raising=False)


@pytest.fixture
def fake_sdk(monkeypatch):
    """Подменяет gigachat.GigaChat: запоминает аргументы, отдаёт список моделей."""
    calls = []

    class FakeGiga:
        def __init__(self, **kw):
            calls.append(kw)

        def get_models(self):
            return types.SimpleNamespace(data=[types.SimpleNamespace(id_="GigaChat-2-Max"), types.SimpleNamespace(id_="GigaChat-2")])

    monkeypatch.setitem(sys.modules, "gigachat", types.SimpleNamespace(GigaChat=FakeGiga))
    return calls


def test_три_подключения_и_их_готовность(monkeypatch):
    assert lc.LLMClient.BUILTIN_PROVIDERS == ["gigachat_pers", "gigachat_corp", "gigachat"]
    st = {p["id"]: p for p in lc.LLMClient.get_available_providers()}
    assert st["gigachat_pers"]["name"] == "Giga Личный" and st["gigachat_pers"]["status"] == "no_key"
    assert "модель" in st["gigachat_pers"]["message"] and "ключ" in st["gigachat_pers"]["message"]
    assert "клиентский сертификат" in st["gigachat"]["message"]
    monkeypatch.setenv("GIGACHAT_CORP_AUTH_KEY", "K")
    monkeypatch.setenv("GIGACHAT_CORP_MODEL", "GigaChat-2-Max")
    assert lc._builtin_status("gigachat_corp")["status"] == "ready"


def test_личный_и_corp_дозваниваются_по_ключу_из_формы_без_сертификата_ift(monkeypatch, fake_sdk):
    monkeypatch.setenv("GIGACHAT_CLIENT_CERT_PATH", "/tmp/ift.pem")       # сертификат IFT не должен попасть в публичный API
    assert lc.list_gigachat_models("gigachat_pers", credentials="PERS") == ["GigaChat-2", "GigaChat-2-Max"]
    kw = fake_sdk[-1]
    assert kw["credentials"] == "PERS" and kw["scope"] == "GIGACHAT_API_PERS" and kw["base_url"] == lc.GIGA_PUBLIC_URL
    assert "cert_file" not in kw
    lc.list_gigachat_models("gigachat_corp", credentials="CORP", scope="gigachat_api_b2b")
    assert fake_sdk[-1]["scope"] == "GIGACHAT_API_B2B"
    lc.list_gigachat_models("gigachat_corp", credentials="CORP", scope="чужой")
    assert fake_sdk[-1]["scope"] == "GIGACHAT_API_CORP"                  # неизвестный scope → по умолчанию
    with pytest.raises(ValueError, match="Giga Личный"):
        lc.list_gigachat_models("gigachat_pers")                          # ключа нет ни в форме, ни в настройках


def test_клиент_берёт_модель_и_scope_своего_подключения(monkeypatch, fake_sdk):
    monkeypatch.setenv("GIGACHAT_CORP_AUTH_KEY", "CORP")
    monkeypatch.setenv("GIGACHAT_CORP_SCOPE", "GIGACHAT_API_B2B")
    monkeypatch.setenv("GIGACHAT_CORP_MODEL", "GigaChat-2-Pro")
    c = lc.LLMClient("gigachat_corp")
    assert (c.auth_type, c.model) == ("api_key", "GigaChat-2-Pro")
    assert fake_sdk[-1]["scope"] == "GIGACHAT_API_B2B" and fake_sdk[-1]["model"] == "GigaChat-2-Pro"


def test_ift_всегда_по_сертификату(monkeypatch):
    monkeypatch.setenv("GIGACHAT_AUTH_TYPE", "api_key")                   # прежний переключатель больше не действует
    monkeypatch.setenv("GIGACHAT_CLIENT_CERT_PATH", "/tmp/ift.pem")
    monkeypatch.setenv("GIGACHAT_MODEL", "GigaChat-2-Max")
    import httpx
    monkeypatch.setattr(httpx, "Client", lambda **kw: kw)                 # файла сертификата нет — mTLS не поднимаем
    c = lc.LLMClient("gigachat")
    assert c._giga_http["cert"] == "/tmp/ift.pem"
    assert c.auth_type == "certificate" and c.base_url == lc.GIGA_IFT_URL and c.model == "GigaChat-2-Max"


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    MetricsSettings.__table__.create(engine)
    s = sessionmaker(bind=engine, autoflush=False)()
    yield s
    s.close()


def _kv(db):
    return {r.key: r.value for r in db.query(MetricsSettings).all()}


def test_перенос_старого_ключа_corp_и_модели(db):
    db.add_all([MetricsSettings(key="gigachat_auth_type", value="api_key"),
                MetricsSettings(key="gigachat_auth_key", value="OLD"),
                MetricsSettings(key="gigachat_scope", value="GIGACHAT_API_CORP"),
                MetricsSettings(key="gigachat_model", value="GigaChat-Pro"),
                MetricsSettings(key="gigachat_base_url", value=lc.GIGA_PUBLIC_URL)])
    db.commit()
    AS._ensure_defaults(db)
    kv = _kv(db)
    assert kv["gigachat_corp_auth_key"] == "OLD" and kv["gigachat_corp_model"] == "GigaChat-Pro"
    assert kv["gigachat_corp_scope"] == "GIGACHAT_API_CORP" and kv["gigachat_pers_auth_key"] == ""
    assert kv["gigachat_base_url"] == lc.GIGA_IFT_URL                    # IFT больше не смотрит на публичный API
    assert not {"gigachat_auth_type", "gigachat_auth_key", "gigachat_scope"} & kv.keys()
    db.query(MetricsSettings).filter(MetricsSettings.key == "gigachat_corp_auth_key").first().value = "NEW"
    db.commit()
    AS._ensure_defaults(db)                                               # второй раз ничего не переносит
    assert _kv(db)["gigachat_corp_auth_key"] == "NEW"


def test_перенос_при_сертификате_ключ_из_env_в_личный(db, monkeypatch):
    monkeypatch.setenv("GIGACHAT_AUTH_KEY", "FROM_ENV")
    db.add_all([MetricsSettings(key="gigachat_auth_type", value="certificate"),
                MetricsSettings(key="gigachat_model", value="GigaChat-2-Max"),
                MetricsSettings(key="gigachat_base_url", value=lc.GIGA_IFT_URL + "x")])
    db.commit()
    AS._ensure_defaults(db)
    kv = _kv(db)
    assert kv["gigachat_pers_auth_key"] == "FROM_ENV" and kv["gigachat_pers_model"] == ""   # модель IFT не чужая
    assert kv["gigachat_model"] == "GigaChat-2-Max" and kv["gigachat_base_url"] == lc.GIGA_IFT_URL + "x"


def test_401_при_подключении_понятным_текстом():
    e = Exception("(URL('https://ngw.devices.sberbank.ru:9443/api/v2/oauth'), 401, b'{\"message\":\"credentials doesn\\'t match db data\"}')")
    assert "Ключ авторизации не подошёл (401)" in AS._giga_auth_hint(e)
    assert AS._giga_auth_hint(Exception("timeout")) == ""
