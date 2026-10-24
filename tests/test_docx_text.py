"""DOCX → Markdown встроенным разбором (agents/docx_text.py): DOCX собирается вручную — без python-docx."""

import io
import zipfile

import pytest

from agents import file_parser
from agents.docx_text import docx_markdown

NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _docx(body: str, styles: str = "", numbering: str = "") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f'<w:document {NS}><w:body>{body}</w:body></w:document>')
        if styles:
            z.writestr("word/styles.xml", f"<w:styles {NS}>{styles}</w:styles>")
        if numbering:
            z.writestr("word/numbering.xml", f"<w:numbering {NS}>{numbering}</w:numbering>")
    return buf.getvalue()


def _p(*runs: str, style: str = "", num: tuple[str, int] | None = None) -> str:
    ppr = ""
    if style or num:
        ppr = "<w:pPr>" + (f'<w:pStyle w:val="{style}"/>' if style else "") + (
            f'<w:numPr><w:ilvl w:val="{num[1]}"/><w:numId w:val="{num[0]}"/></w:numPr>' if num else "") + "</w:pPr>"
    return f"<w:p>{ppr}{''.join(runs)}</w:p>"


def _r(text: str, bold: bool = False, sz: int = 0) -> str:
    rpr = ("<w:b/>" if bold else "") + (f'<w:sz w:val="{sz}"/>' if sz else "")
    return f'<w:r>{"<w:rPr>" + rpr + "</w:rPr>" if rpr else ""}<w:t xml:space="preserve">{text}</w:t></w:r>'


STYLES = ('<w:style w:type="paragraph" w:styleId="H1"><w:name w:val="heading 1"/></w:style>'
          '<w:style w:type="paragraph" w:styleId="Z2"><w:name w:val="Заголовок 2"/></w:style>')
NUMBERING = ('<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>'
             '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>'
             '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>'
             '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>')


def test_стили_заголовков_списки_word_жирное_и_таблица():
    body = (
        _p(_r("Карточка"), style="H1")
        + _p(_r("Поля"), style="Z2")
        + _p(_r("Сократить время "), _r("реакции", bold=True), _r(" диспетчера."))
        + _p(_r("Номер"), num=("1", 0)) + _p(_r("Формат"), num=("1", 1)) + _p(_r("Адрес"), num=("1", 0))
        + _p(_r("Открыть"), num=("2", 0)) + _p(_r("Закрыть"), num=("2", 0))
        + _p(_r("Примечание:", bold=True))
        + "<w:tbl><w:tr><w:tc>" + _p(_r("Условие")) + "</w:tc><w:tc>" + _p(_r("Итог")) + "</w:tc></w:tr>"
        + "<w:tr><w:tc>" + _p(_r("a | b")) + "</w:tc><w:tc>" + _p(_r("да")) + "</w:tc></w:tr></w:tbl>"
        + '<w:p><w:r><w:delText>удалено</w:delText></w:r></w:p>'
    )
    assert docx_markdown(_docx(body, STYLES, NUMBERING)) == (
        "# Карточка\n\n## Поля\n\nСократить время **реакции** диспетчера.\n\n"
        "- Номер\n  - Формат\n- Адрес\n1. Открыть\n2. Закрыть\n\n**Примечание:**\n\n"
        "| Условие | Итог |\n|---|---|\n| a \\| b | да |"
    )


def test_без_стилей_заголовки_по_кеглю_и_маркеры_текстом():
    body = (
        _p(_r("Техническое задание", bold=True, sz=48))
        + _p(_r("Назначение", bold=True, sz=32))
        + _p(_r("Текст абзаца основным кеглем, его больше всего.", sz=24))
        + _p(_r("•", sz=24), '<w:r><w:tab/></w:r>', _r("Первый пункт", sz=24))
        + _p(_r("1", sz=24), '<w:r><w:tab/></w:r>', _r("Шаг один", sz=24))
        + _p(_r("Ограничения", bold=True, sz=24))
    )
    assert docx_markdown(_docx(body)) == (
        "# Техническое задание\n\n## Назначение\n\nТекст абзаца основным кеглем, его больше всего.\n\n"
        "- Первый пункт\n1. Шаг один\n\n### Ограничения"
    )


def test_не_docx_и_парсер_файлов():
    with pytest.raises(ValueError, match="не DOCX"):
        docx_markdown(b"not a zip")
    data = _docx(_p(_r("Карточка"), style="H1") + _p(_r("Текст.")), STYLES)
    assert file_parser.parse_file(data, "spec.docx", markdown=True) == "# Карточка\n\nТекст."


def test_без_python_docx_обычный_разбор_берёт_встроенный(monkeypatch):
    import builtins
    real = builtins.__import__

    def no_docx(name, *a, **kw):
        if name == "docx":
            raise ImportError(name)
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", no_docx)
    data = _docx(_p(_r("Карточка"), style="H1") + _p(_r("Текст.")), STYLES)
    assert file_parser.parse_file(data, "spec.docx") == "# Карточка\n\nТекст."
