"""Нет нужного пакета в окружении — понятная ошибка, а не «No module named …».

После обновления кода в старом окружении могло не оказаться playwright/cryptography
(start.sh ставил зависимости только в пустое окружение). Веб-коннектор при этом
показывал сырое «No module named 'playwright'». Теперь — что сделать.
"""

import asyncio
import sys

import pytest

from webconnect import secrets
from webconnect.browser import MISSING_PLAYWRIGHT, ConnectorWindow, WebError


def test_нет_playwright_понятная_ошибка(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "playwright", None)
    monkeypatch.setitem(sys.modules, "playwright.async_api", None)
    w = ConnectorWindow({"id": "wc-test", "name": "t", "base_url": "https://x"})
    w.profile_dir = tmp_path / "profile"
    with pytest.raises(WebError) as e:
        asyncio.run(w.open(headless=True))
    assert str(e.value) == MISSING_PLAYWRIGHT
    assert "pip install -r requirements.txt" in str(e.value)


def test_нет_cryptography_бэкенд_жив_ошибка_при_сохранении(monkeypatch):
    monkeypatch.setitem(sys.modules, "cryptography", None)
    monkeypatch.setitem(sys.modules, "cryptography.fernet", None)
    with pytest.raises(secrets.SecretError) as e:
        secrets.encrypt("пароль")
    assert "cryptography" in str(e.value)
