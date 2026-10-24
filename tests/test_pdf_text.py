"""Встроенный разбор PDF (agents/pdf_text.py) — без PyPDF2: собранные вручную PDF разных видов."""

import zlib

import pytest

from agents import file_parser
from agents.pdf_text import extract_pages


def _pdf(objs: dict[int, bytes], root: int = 1) -> bytes:
    """Минимальный PDF из тел объектов {номер: b'<<…>>' или поток}."""
    out = bytearray(b"%PDF-1.5\n")
    for n in sorted(objs):
        out += f"{n} 0 obj\n".encode() + objs[n] + b"\nendobj\n"
    out += f"trailer\n<< /Root {root} 0 R >>\n%%EOF\n".encode()
    return bytes(out)


def _stream(data: bytes, extra: bytes = b"", flate: bool = False) -> bytes:
    if flate:
        data = zlib.compress(data)
        extra += b" /Filter /FlateDecode"
    return b"<< /Length " + str(len(data)).encode() + extra + b" >>\nstream\n" + data + b"\nendstream"


def _page_tree(content_obj: int, font_obj: int) -> dict[int, bytes]:
    return {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: f"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 {font_obj} 0 R >> >> /Contents {content_obj} 0 R >>".encode(),
    }


def test_простой_шрифт_строки_и_переносы():
    content = b"BT /F1 12 Tf 72 700 Td (Hello \\(World\\)) Tj 0 -14 Td (Second line) Tj ET"
    pdf = _pdf({**_page_tree(4, 5), 4: _stream(content), 5: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"})
    assert extract_pages(pdf) == ["Hello (World)\nSecond line"]


def test_кириллица_cid_шрифт_tounicode_сжатие_и_поток_объектов():
    # Коды 0x0001–0x0003 → «При», 0x0010 → «т» через bfrange/bfchar; ширина 500 — стыки кусков без пробела.
    cmap = (b"begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange "
            b"1 beginbfrange <0001> <0003> [<041F> <0440> <0438>] endbfrange "
            b"2 beginbfchar <0010> <0442> <0020> <0020> endbfchar endcmap")
    # Кусок «При» (3 символа × 500 × 10 / 1000 = 15) и «т» вплотную (Td 15) — одно слово; потом зазор — пробел.
    content = b"BT /F1 10 Tf 1 0 0 1 50 700 Tm <000100020003> Tj 15 0 Td <0010> Tj 30 0 Td <00020003> Tj ET"
    font = b"<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 6 0 R >>"
    desc = b"<< /Type /Font /Subtype /CIDFontType2 /DW 500 >>"
    # Словари шрифтов — в потоке объектов (ObjStm), как в PDF 1.5+.
    body = font + b" " + desc
    header = f"5 0 7 {len(font) + 1} ".encode()
    objstm = _stream(header + body, f" /Type /ObjStm /N 2 /First {len(header)}".encode(), flate=True)
    pdf = _pdf({**_page_tree(4, 5), 4: _stream(content, flate=True), 6: _stream(cmap, flate=True), 8: objstm})
    assert extract_pages(pdf) == ["Прит ри"]


def test_имена_глифов_afii_и_macroman():
    content = b"BT /F1 12 Tf 10 10 Td <4142> Tj ( \xd1 \xc7ok\xc8) Tj ET"
    font = (b"<< /Type /Font /Subtype /Type1 /Encoding << /BaseEncoding /MacRomanEncoding "
            b"/Differences [65 /afii10017 /afii10071] >> >>")
    pdf = _pdf({**_page_tree(4, 5), 4: _stream(content), 5: font})
    assert extract_pages(pdf) == ["Аё — «ok»"]


def test_зашифрованный_и_не_pdf():
    with pytest.raises(ValueError, match="зашифрован"):
        extract_pages(b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n%%EOF")
    with pytest.raises(ValueError, match="не PDF"):
        extract_pages(b"hello")


def test_парсер_файлов_без_pypdf2_берёт_встроенный_разбор(monkeypatch):
    monkeypatch.setattr(file_parser, "_pdf_pages_library", lambda data: None)
    content = b"BT /F1 12 Tf 72 700 Td (Requirements) Tj ET"
    pdf = _pdf({**_page_tree(4, 5), 4: _stream(content), 5: b"<< /Type /Font /Subtype /Type1 >>"})
    assert file_parser.parse_file(pdf, "spec.pdf") == "--- Страница 1 ---\nRequirements"


def test_pdf_без_текста_честная_ошибка(monkeypatch):
    monkeypatch.setattr(file_parser, "_pdf_pages_library", lambda data: None)
    pdf = _pdf({**_page_tree(4, 5), 4: _stream(b"q 1 0 0 1 0 0 cm Q"), 5: b"<< /Type /Font /Subtype /Type1 >>"})
    with pytest.raises(ValueError, match="скан"):
        file_parser.parse_file(pdf, "scan.pdf")


# ── PDF → Markdown ───────────────────────────────────────────────────────────

def _md_pdf(pages: list[bytes]) -> bytes:
    """PDF из нескольких страниц: F1 — обычный Helvetica, F2 — Helvetica-Bold."""
    n = len(pages)
    kids = " ".join(f"{10 + i} 0 R" for i in range(n))
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode(),
        5: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        6: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    }
    for i, content in enumerate(pages):
        objs[10 + i] = (f"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> "
                        f"/Contents {30 + i} 0 R >>").encode()
        objs[30 + i] = _stream(content)
    return _pdf(objs)


def _ln(text: str, y: float, size: int = 10, bold: bool = False, x: float = 50) -> bytes:
    font = b"/F2" if bold else b"/F1"
    esc = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return b"BT " + font + f" {size} Tf 1 0 0 1 {x} {y} Tm (".encode() + esc.encode("latin-1") + b") Tj ET\n"


def test_markdown_заголовки_по_кеглю_и_жирности_абзацы_и_списки():
    from agents.pdf_text import pdf_markdown
    page = b"".join([
        _ln("Specification", 760, 20),
        _ln("Overview", 730, 15),
        _ln("The system accepts a call and checks the", 710),
        _ln("data before sending it on.", 698),
        _ln("Second paragraph starts after a gap.", 676),
        _ln("Access rules", 650, bold=True),
        _ln("Note:", 630, bold=True),
        _ln("- first item", 610),
        _ln("- second item that wraps onto", 598),
        _ln("1) open the card", 586),
        _ln("2) press close", 574),
    ])
    assert pdf_markdown(_md_pdf([page])) == (
        "# Specification\n\n## Overview\n\n"
        "The system accepts a call and checks the data before sending it on.\n\n"
        "Second paragraph starts after a gap.\n\n### Access rules\n\n**Note:**\n\n"
        "- first item\n- second item that wraps onto\n1. open the card\n2. press close"
    )


def test_markdown_колонтитулы_номера_страниц_и_абзац_через_страницу():
    from agents.pdf_text import pdf_markdown
    pages = []
    for i in range(3):
        body = _ln("Line one of the text that continues" if i == 0 else "on the next page and ends here.", 700)
        if i == 2:
            body = _ln("Final paragraph.", 700)
        pages.append(_ln("ACME confidential", 790, 8) + body + _ln(str(i + 1), 40, 8))
    md = pdf_markdown(_md_pdf(pages))
    assert "ACME" not in md and "\n1\n" not in md
    assert md == "Line one of the text that continues on the next page and ends here.\n\nFinal paragraph."


def test_markdown_список_по_отступу_когда_маркер_картинкой():
    from agents.pdf_text import pdf_markdown
    page = b"".join([
        _ln("Fields of the card:", 700),
        _ln("Number is unique.", 688, x=70),
        _ln("Address is required and is checked", 676, x=70),
        _ln("against the directory.", 664, x=70),
        _ln("Status is one of three.", 652, x=70),
        _ln("Closed cards are read only.", 630),
    ])
    assert pdf_markdown(_md_pdf([page])) == (
        "Fields of the card:\n\n- Number is unique.\n- Address is required and is checked against the directory.\n"
        "- Status is one of three.\n\nClosed cards are read only."
    )


def test_парсер_файлов_pdf_в_markdown_по_флагу():
    pdf = _md_pdf([_ln("Title", 760, 20) + _ln("Body text.", 730)])
    assert file_parser.parse_file(pdf, "spec.pdf", markdown=True) == "# Title\n\nBody text."
    assert file_parser.parse_file(pdf, "spec.pdf").startswith("--- Страница 1 ---")
