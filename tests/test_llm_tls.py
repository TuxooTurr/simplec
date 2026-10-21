"""TLS к LLM: потолок TLS 1.2 действует и без проверки сертификата; подсказка при «Connection reset by peer»."""

import ssl

import pytest

import agents.llm_client as lc


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ("SSL_NO_VERIFY", "SSL_MAX_TLS12", "SSL_CERT_FILE", "GIGACHAT_NO_VERIFY", "GIGACHAT_CA_CERT_PATH"):
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_без_флагов_проверка_по_certifi():
    v = lc._get_verify()
    assert isinstance(v, ssl.SSLContext) and v.verify_mode == ssl.CERT_REQUIRED


def test_no_verify_без_tls12_как_раньше(clean_env):
    clean_env.setenv("SSL_NO_VERIFY", "1")
    assert lc._get_verify() is False
    assert lc._get_verify(True) is False


def test_no_verify_вместе_с_tls12_даёт_контекст_с_потолком(clean_env):
    clean_env.setenv("SSL_NO_VERIFY", "1")
    clean_env.setenv("SSL_MAX_TLS12", "1")
    v = lc._get_verify()
    assert isinstance(v, ssl.SSLContext)                      # раньше — голый False, потолок терялся
    assert v.maximum_version == ssl.TLSVersion.TLSv1_2 and v.verify_mode == ssl.CERT_NONE and not v.check_hostname


def test_свой_ca_важнее_глобального_no_verify(clean_env, tmp_path):
    import certifi
    ca = certifi.where()
    clean_env.setenv("SSL_NO_VERIFY", "1")
    assert lc._get_verify(None, ca) == ca                     # как раньше: явный CA — проверяем по нему
    clean_env.setenv("SSL_MAX_TLS12", "1")
    v = lc._get_verify(None, ca)
    assert v.verify_mode == ssl.CERT_REQUIRED and v.maximum_version == ssl.TLSVersion.TLSv1_2


def test_gigachat_sdk_с_tls12_без_ca_не_включает_проверку(clean_env):
    clean_env.setenv("SSL_MAX_TLS12", "1")
    ctx = lc._gigachat_tls_kwargs()["ssl_context"]
    assert ctx.verify_mode == ssl.CERT_NONE and ctx.maximum_version == ssl.TLSVersion.TLSv1_2
    clean_env.delenv("SSL_MAX_TLS12")
    assert lc._gigachat_tls_kwargs() == {"verify_ssl_certs": False}


def test_подсказка_при_сбросе_соединения(clean_env):
    e = ConnectionResetError(54, "Connection reset by peer")
    assert "TLS 1.2" in lc.connection_reset_hint(e) and "Включите" in lc.connection_reset_hint(e)
    wrapped = RuntimeError("[Errno 54] Connection reset by peer")
    assert lc.connection_reset_hint(wrapped)
    clean_env.setenv("SSL_MAX_TLS12", "1")
    assert "уже включён" in lc.connection_reset_hint(e)
    assert lc.connection_reset_hint(ValueError("401 unauthorized")) == ""
    assert lc.LLMClient.classify_error(e) == (True, lc.connection_reset_hint(e))
