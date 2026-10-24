"""
Парсер файлов с валидацией безопасности.
Поддержка: PDF, Word, Excel, XML, изображения (OCR), TXT, Markdown.
"""

import io

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".xlsx", ".xls",
    ".xml", ".png", ".jpg", ".jpeg", ".txt", ".log", ".md", ".markdown"
}


def validate_file(data: bytes, filename: str) -> None:
    """Валидация файла перед парсингом."""
    if len(data) > MAX_FILE_SIZE:
        raise ValueError(
            "Файл слишком большой: "
            + str(len(data) // (1024 * 1024))
            + " MB (макс. 50 MB)"
        )

    ext = ""
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[-1].lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            "Недопустимый формат: " + ext
            + " (разрешены: " + ", ".join(sorted(ALLOWED_EXTENSIONS)) + ")"
        )

    if len(data) == 0:
        raise ValueError("Файл пустой")


def parse_file(data: bytes, filename: str, markdown: bool = False) -> str:
    """Извлекает текст из файла с предварительной валидацией.
    markdown=True — PDF и DOCX собираются в Markdown (заголовки, списки, абзацы, таблицы DOCX) для «Данных»."""

    validate_file(data, filename)

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "pdf":
        return _parse_pdf_markdown(data) if markdown else _parse_pdf(data)
    elif ext in ("docx", "doc"):
        return _parse_docx_markdown(data) if markdown else _parse_docx(data)
    elif ext in ("xlsx", "xls"):
        return _parse_xlsx(data)
    elif ext == "xml":
        return _parse_xml(data)
    elif ext in ("png", "jpg", "jpeg"):
        return _parse_image(data)
    elif ext in ("txt", "log", "md", "markdown"):   # Markdown — как есть: разметку отрисует интерфейс
        return _parse_txt(data)
    else:
        return data.decode("utf-8", errors="ignore")


def _pdf_pages_library(data: bytes) -> list[str] | None:
    """Текст страниц через PyPDF2 / pypdf, если библиотека установлена; нет ни одной — None."""
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        try:
            from pypdf import PdfReader
        except ImportError:
            return None
    reader = PdfReader(io.BytesIO(data))
    return [page.extract_text() or "" for page in reader.pages]


def _parse_pdf(data: bytes) -> str:
    # Ошибки поднимаем, а не возвращаем заглушкой: иначе в LLM молча уходит
    # «[PDF: текст не извлечён]» вместо содержимого, и модель «не видит файл».
    # PyPDF2 не входит в requirements, а скачать его в корп. сети нельзя — тогда (и если библиотека не нашла
    # текста) работает встроенный разбор agents/pdf_text.py без сторонних библиотек.
    pages: list[str] = []
    try:
        pages = _pdf_pages_library(data) or []
    except Exception:
        pages = []
    if not any(p.strip() for p in pages):
        from agents.pdf_text import extract_pages
        try:
            pages = extract_pages(data)
        except ValueError as e:
            raise ValueError("Не удалось прочитать PDF: " + str(e)[:200])
        except Exception as e:
            raise ValueError("Не удалось прочитать PDF: " + type(e).__name__ + ": " + str(e)[:200])
    result = "\n\n".join("--- Страница " + str(i + 1) + " ---\n" + t for i, t in enumerate(pages) if t.strip())
    if not result.strip():
        raise ValueError(
            "В PDF нет текстового слоя (похоже, это скан). "
            "Сохраните страницы как PNG/JPG и приложите их — сработает распознавание текста (OCR)."
        )
    return result


def _parse_pdf_markdown(data: bytes) -> str:
    """PDF → Markdown встроенным разбором (agents/pdf_text.pdf_markdown): структуру восстанавливают кегль, жирность
    и отступы, которых нет в выдаче PyPDF2. Не вышло — обычный текст по страницам (с той же ошибкой для сканов)."""
    from agents.pdf_text import pdf_markdown
    try:
        md = pdf_markdown(data)
    except Exception:
        md = ""
    return md if md.strip() else _parse_pdf(data)


def _parse_docx_markdown(data: bytes) -> str:
    """DOCX → Markdown встроенным разбором (agents/docx_text.py): стили заголовков, списки Word, таблицы, жирное.
    Не вышло — обычный текст через python-docx (с его понятными ошибками, например для старого .doc)."""
    from agents.docx_text import docx_markdown
    try:
        md = docx_markdown(data)
    except Exception:
        md = ""
    return md if md.strip() else _parse_docx(data)


def _parse_docx(data: bytes) -> str:
    # Ошибки поднимаем, а не возвращаем заглушкой (см. _parse_pdf) — иначе текст
    # вида «[Ошибка DOCX: ...]» уходит в LLM как будто это содержимое файла.
    try:
        from docx import Document
    except ImportError:
        # python-docx не установлен (скачать в корп. сети нельзя) — встроенный разбор, он без библиотек.
        from agents.docx_text import docx_markdown
        try:
            result = docx_markdown(data)
        except ValueError:
            raise ValueError("Не удалось прочитать DOCX. Если файл в старом формате .doc — пересохраните его как .docx в Word.")
        if not result.strip():
            raise ValueError("Документ DOCX пустой")
        return result
    try:
        doc = Document(io.BytesIO(data))
        paragraphs = []
        for para in doc.paragraphs:
            if para.text.strip():
                paragraphs.append(para.text)

        for table in doc.tables:
            for row in table.rows:
                cells = []
                for cell in row.cells:
                    if cell.text.strip():
                        cells.append(cell.text.strip())
                if cells:
                    paragraphs.append(" | ".join(cells))

        result = "\n".join(paragraphs)
    except Exception as e:
        raise ValueError(
            "Не удалось прочитать DOCX: " + str(e)[:200] + ". "
            "Если файл в старом формате .doc — пересохраните его как .docx в Word."
        )
    if not result.strip():
        raise ValueError("Документ DOCX пустой")
    return result


def _parse_xlsx(data: bytes) -> str:
    # Ошибки поднимаем, а не возвращаем заглушкой (см. _parse_pdf).
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise ValueError("XLSX не обработан: на сервере не установлен openpyxl")
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheets = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = []
            for row in ws.iter_rows(values_only=True):
                cells = []
                for cell in row:
                    if cell is not None:
                        cells.append(str(cell))
                if cells:
                    rows.append(" | ".join(cells))
            if rows:
                sheets.append(
                    "=== Лист: " + sheet_name + " ===\n"
                    + "\n".join(rows)
                )
        wb.close()
        result = "\n\n".join(sheets)
    except Exception as e:
        raise ValueError(
            "Не удалось прочитать XLSX: " + str(e)[:200] + ". "
            "Если файл в старом формате .xls — пересохраните его как .xlsx в Excel."
        )
    if not result.strip():
        raise ValueError("Таблица XLSX пустая")
    return result


def _parse_xml(data: bytes) -> str:
    text = data.decode("utf-8", errors="ignore")
    if not text.strip():
        raise ValueError("XML-файл пустой")
    return text


def _parse_image(data: bytes) -> str:
    # Ошибки поднимаем, а не возвращаем заглушкой: раньше при отсутствии
    # tesseract в LLM молча уходило «[OCR недоступен]» и модель «не видела» картинку.
    try:
        from PIL import Image
        import pytesseract
    except ImportError:
        raise ValueError(
            "Распознавание изображений недоступно: не установлены Pillow/pytesseract "
            "(pip install Pillow pytesseract)"
        )
    try:
        img = Image.open(io.BytesIO(data))
        text = pytesseract.image_to_string(img, lang="rus+eng")
    except pytesseract.TesseractNotFoundError:
        raise ValueError(
            "Распознавание изображений недоступно: не установлен движок Tesseract. "
            "macOS: brew install tesseract tesseract-lang · Linux: apt install tesseract-ocr tesseract-ocr-rus"
        )
    except Exception as e:
        raise ValueError("Не удалось распознать изображение: " + str(e)[:200])
    if not text.strip():
        raise ValueError(
            "На изображении не распознан текст. Проверьте качество скриншота "
            "(масштаб, контраст) или перенесите текст в поле требования вручную."
        )
    return text


def _parse_txt(data: bytes) -> str:
    # Ошибки поднимаем, а не возвращаем заглушкой (см. _parse_pdf).
    for encoding in ("utf-8", "cp1251", "latin-1"):
        try:
            text = data.decode(encoding)
            if text.strip():
                return text
        except UnicodeDecodeError:
            continue
    raise ValueError("Не удалось декодировать текстовый файл (пустой или нетекстовый файл)")

