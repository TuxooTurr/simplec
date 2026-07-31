"""Вложения баг-репорта: логи читаются как текст, скриншоты попадают в описание.

Раньше от приложенной картинки в дефект уходил только распознанный текст (OCR) —
самой картинки в описании не было. Теперь описание ссылается на скриншот
разметкой, а файл прикладывается к дефекту под тем же именем.
"""

import pytest

from agents.file_parser import ALLOWED_EXTENSIONS, parse_file
from backend.api.bugs import _parse_report, is_image, safe_attachment_name, with_screenshots
from backend.api.jira_defects import _md_to_jira


# ── Логи ─────────────────────────────────────────────────────────────────────

def test_лог_разрешён_к_загрузке():
    assert ".log" in ALLOWED_EXTENSIONS


def test_лог_читается_как_текст():
    data = "2026-07-30 ERROR NullPointerException at Foo.bar\n".encode("utf-8")
    assert "NullPointerException" in parse_file(data, "app.log")


def test_лог_в_кодировке_windows_читается():
    """Логи с корпоративных стендов часто приходят в cp1251."""
    data = "ОШИБКА: сервис недоступен".encode("cp1251")
    assert "ОШИБКА" in parse_file(data, "service.log")


def test_лог_не_считается_скриншотом():
    assert not is_image("app.log")
    assert not is_image("dump.txt")


# ── Имена скриншотов ─────────────────────────────────────────────────────────

def test_картинки_распознаются_по_расширению():
    assert is_image("screen.png")
    assert is_image("SCREEN.JPG")
    assert is_image("photo.jpeg")


@pytest.mark.parametrize("raw, expected", [
    ("bug.PNG",                      "bug.png"),      # регистр расширения нормализуем
    ("ok_1.jpeg",                    "ok_1.jpeg"),
    ("Снимок экрана 2026-07-30.png", "2026-07-30.png"),
])
def test_имя_вложения_приводится_к_безопасному(raw, expected):
    assert safe_attachment_name(raw, 0) == expected


@pytest.mark.parametrize("raw", ["....png", "___.jpg", "скрин.png"])
def test_имя_без_латиницы_и_цифр_заменяется(raw):
    """Из одних точек, подчёркиваний или кириллицы Jira сделает мусор."""
    name = safe_attachment_name(raw, 0)
    assert name.startswith("screenshot_1.")
    assert any(c.isalnum() for c in name)


def test_имя_вложения_без_пробелов_и_кириллицы():
    name = safe_attachment_name("Отчёт по багу 12.png", 3)
    assert " " not in name
    assert name.isascii()


# ── Раздел «Скриншоты» в отчёте ──────────────────────────────────────────────

REPORT = (
    "# [Back][Заявки] Ошибка при отправке\n\n"
    "## Описание дефекта\n"
    "Заявка не создаётся.\n\n"
    "Приоритет: Высокий"
)


def test_без_скриншотов_отчёт_не_меняется():
    assert with_screenshots(REPORT, []) == REPORT


def test_скриншоты_добавляются_в_отчёт():
    out = with_screenshots(REPORT, ["a.png", "b.png"])
    assert "## Скриншоты" in out
    assert "![a.png](a.png)" in out
    assert "![b.png](b.png)" in out


def test_приоритет_остаётся_последней_строкой():
    """Строка приоритета по шаблону последняя, и на этом держится разбор отчёта."""
    out = with_screenshots(REPORT, ["a.png"])
    assert out.rstrip().splitlines()[-1].startswith("Приоритет:")


def test_скриншоты_попадают_в_описание_для_jira():
    out = with_screenshots(REPORT, ["a.png"])
    parsed = _parse_report(out)
    assert parsed["priority"] == "Высокий"
    assert "![a.png](a.png)" in parsed["description"]


def test_отчёт_без_строки_приоритета_не_теряет_скриншоты():
    """Модель может не дописать приоритет — картинку всё равно не теряем."""
    out = with_screenshots("# Заголовок\n\nТекст", ["a.png"])
    assert "![a.png](a.png)" in out


# ── Разметка для Jira ────────────────────────────────────────────────────────

def test_картинка_превращается_в_разметку_jira():
    assert _md_to_jira("![a.png](a.png)") == "!a.png|thumbnail!"


def test_разметка_картинки_не_ломает_остальное_форматирование():
    src = "## Скриншоты\n\n![s.png](s.png)\n\nТекст **жирный** и `код`"
    out = _md_to_jira(src)
    assert "h2. Скриншоты" in out
    assert "!s.png|thumbnail!" in out
    assert "*жирный*" in out
    assert "{{код}}" in out


def test_имя_в_описании_совпадает_с_именем_вложения():
    """Связка держится на совпадении имён: разъедутся — Jira покажет текст
    вместо картинки."""
    name = safe_attachment_name("Снимок экрана.png", 0)
    out = _md_to_jira(with_screenshots(REPORT, [name]))
    assert f"!{name}|thumbnail!" in out


# ── Контракт загрузки вложений (подтверждён на боевой Jira) ──────────────────

def _prepared_attach_request(names_and_files):
    """Строит тот же запрос, что и attach_files, но не отправляет его."""
    import requests
    headers = {
        "Authorization": "Bearer TOKEN",
        "X-Atlassian-Token": "no-check",
        "User-Agent": "Mozilla/5.0 (compatible; SimpleTest-QA/1.0)",
    }
    payload = [("file", (n, data, ct)) for n, data, ct in names_and_files]
    return requests.Request(
        "POST", "https://jira.example/rest/api/2/issue/SBER911-1/attachments",
        headers=headers, files=payload,
    ).prepare()


def test_запрос_вложения_соответствует_контракту_jira():
    """Проверено вручную на jira.sberbank.ru: без этих деталей 403 XSRF
    либо «file is required»."""
    req = _prepared_attach_request([
        ("screenshot_1.png", b"\x89PNG", "image/png"),
        ("app.log", b"error", "text/plain"),
    ])
    body = req.body if isinstance(req.body, bytes) else req.body.encode()

    assert req.method == "POST"
    assert req.url.endswith("/issue/SBER911-1/attachments")
    assert req.headers["X-Atlassian-Token"] == "no-check"
    # Content-Type с boundary проставляет requests — вручную его задавать нельзя
    assert req.headers["Content-Type"].startswith("multipart/form-data; boundary=")
    # Поле обязано называться именно file, иначе Jira ответит «file is required»
    assert body.count(b'name="file"') == 2
    assert b'filename="screenshot_1.png"' in body
    assert b'filename="app.log"' in body


def test_имя_вложения_уходит_нормализованным_а_не_исходным():
    """Кириллица и пробелы в имени ломают связку с разметкой !имя! в описании."""
    name = safe_attachment_name("Снимок экрана 2026-07-30.png", 0)
    req = _prepared_attach_request([(name, b"x", "image/png")])
    body = req.body if isinstance(req.body, bytes) else req.body.encode()
    assert b'filename="2026-07-30.png"' in body
    assert "Снимок".encode() not in body
