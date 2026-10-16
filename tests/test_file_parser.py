"""Markdown в «Данных»: .md принимается и читается как есть — разметку отрисовывает интерфейс."""

import pytest

from agents.file_parser import parse_file


def test_markdown_kept_as_is():
    text = "# Оплата\n\n- карта\n- **СБП**\n\n| поле | тип |\n|---|---|\n| сумма | число |\n"
    assert parse_file(text.encode("utf-8"), "req.md") == text


def test_markdown_long_extension_and_cp1251():
    assert parse_file("## Заголовок".encode("cp1251"), "req.MARKDOWN") == "## Заголовок"


def test_unknown_extension_still_rejected():
    with pytest.raises(ValueError, match="Недопустимый формат"):
        parse_file(b"x", "req.exe")
