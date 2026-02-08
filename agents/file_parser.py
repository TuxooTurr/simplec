"""
Парсер файлов: PDF, Word, Excel, XML, изображения.
"""

from pathlib import Path
from typing import Optional
import io


def parse_file(file_bytes: bytes, filename: str) -> str:
    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        return _parse_pdf(file_bytes)
    elif ext in (".docx", ".doc"):
        return _parse_docx(file_bytes)
    elif ext in (".xlsx", ".xls"):
        return _parse_excel(file_bytes)
    elif ext == ".xml":
        return _parse_xml(file_bytes)
    elif ext in (".png", ".jpg", ".jpeg", ".bmp", ".tiff"):
        return _parse_image(file_bytes)
    elif ext == ".txt":
        return file_bytes.decode("utf-8", errors="replace")
    else:
        return "[Неподдерживаемый формат: " + ext + "]"


def _parse_pdf(data: bytes) -> str:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(data))
        texts = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                texts.append(t)
        return "\n\n".join(texts) if texts else "[PDF: текст не извлечён]"
    except Exception as e:
        return "[Ошибка PDF: " + str(e) + "]"


def _parse_docx(data: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(data))
        texts = []
        for para in doc.paragraphs:
            if para.text.strip():
                texts.append(para.text)
        for table in doc.tables:
            for row in table.rows:
                row_text = " | ".join(cell.text.strip() for cell in row.cells)
                if row_text.strip():
                    texts.append(row_text)
        return "\n".join(texts) if texts else "[DOCX: текст не извлечён]"
    except Exception as e:
        return "[Ошибка DOCX: " + str(e) + "]"


def _parse_excel(data: bytes) -> str:
    try:
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), data_only=True)
        texts = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            texts.append("=== Лист: " + sheet_name + " ===")
            for row in ws.iter_rows(values_only=True):
                vals = [str(c) if c is not None else "" for c in row]
                line = " | ".join(vals).strip()
                if line and line != "| " * len(vals):
                    texts.append(line)
        return "\n".join(texts) if texts else "[XLSX: данные не извлечены]"
    except Exception as e:
        return "[Ошибка XLSX: " + str(e) + "]"


def _parse_xml(data: bytes) -> str:
    try:
        text = data.decode("utf-8", errors="replace")
        return text
    except Exception as e:
        return "[Ошибка XML: " + str(e) + "]"


def _parse_image(data: bytes) -> str:
    try:
        from PIL import Image
        import pytesseract
        img = Image.open(io.BytesIO(data))
        text = pytesseract.image_to_string(img, lang="rus+eng")
        return text if text.strip() else "[Изображение: текст не распознан]"
    except ImportError:
        return "[Для OCR установите: brew install tesseract]"
    except Exception as e:
        return "[Ошибка OCR: " + str(e) + "]"

