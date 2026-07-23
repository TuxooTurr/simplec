"""
Экспорт отчёта сравнения LLM-моделей в PPTX.

Технические метрики (латентность, токены, успешность) берутся из посчитанных
в коде agents/model_bench.py::compute_stats — те же цифры, что видны в UI,
а не пересчитываются заново и не идут от LLM (значит, точны).

Текст отчёта судьи (Markdown) грубо разбивается на слайды по заголовкам/абзацам:
полноценный Markdown→PPTX рендер (вложенные списки, форматирование) не нужен —
отчёт короткий и линейный, а надёжное разбиение "абзац за слайдом" не теряет
контент вместо хрупкого парсинга разметки.
"""
from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any

from agents.model_bench import compute_stats

_MAX_SLIDE_CHARS = 900


def _strip_md_inline(text: str) -> str:
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    return text


def _md_table_to_lines(block: str) -> list[str]:
    """Простая markdown-таблица -> строки вида 'ячейка — ячейка — ячейка'
    (строка-разделитель ---|--- отбрасывается)."""
    lines = []
    for row in block.splitlines():
        row = row.strip()
        if not row.startswith("|"):
            continue
        cells = [c.strip() for c in row.strip("|").split("|")]
        if all(re.fullmatch(r":?-+:?", c) for c in cells if c):
            continue
        text = " — ".join(_strip_md_inline(c) for c in cells if c)
        if text:
            lines.append(text)
    return lines


def _report_to_slides(report: str) -> list[tuple[str, list[str]]]:
    """Markdown отчёта судьи -> [(заголовок_слайда, [строки_буллетов]), ...].

    Построчно, а не по абзацам (split на "\\n\\n"): заголовок вида "### Модель",
    за которым СРАЗУ (без пустой строки) идёт текст — обычный паттерн в ответах
    LLM — раньше не распознавался как заголовок (regex требовал, чтобы весь
    абзац состоял ровно из одной строки), и "### " утекал в текст буллета."""
    if not report.strip():
        return []
    slides: list[tuple[str, list[str]]] = []
    title = "Отчёт судьи"
    bullets: list[str] = []
    chars = 0
    table_buf: list[str] = []

    def flush_table():
        nonlocal chars
        if table_buf:
            new_lines = _md_table_to_lines("\n".join(table_buf))
            bullets.extend(new_lines)
            chars += sum(len(ln) for ln in new_lines)
            table_buf.clear()

    def flush_slide():
        nonlocal bullets, chars
        flush_table()
        if bullets:
            slides.append((title, list(bullets)))
        bullets.clear()
        chars = 0

    for raw in report.strip().splitlines():
        line = raw.strip()
        if not line:
            flush_table()
            continue
        header_m = re.match(r"^#{1,4}\s+(.+)$", line)
        if header_m:
            flush_slide()
            title = _strip_md_inline(header_m.group(1).strip())
            continue
        if line.startswith("|"):
            table_buf.append(line)
            continue
        flush_table()
        text = _strip_md_inline(re.sub(r"^[-*]\s+|^\d+\.\s+", "", line))
        if chars + len(text) > _MAX_SLIDE_CHARS and bullets:
            flush_slide()
            title = title + " (продолжение)"
        bullets.append(text)
        chars += len(text)

    flush_slide()
    return slides


def build_pptx(session: dict[str, Any]) -> bytes:
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt
    except ImportError:
        raise ValueError("PPTX не сформирован: на сервере не установлен python-pptx")

    stats = compute_stats(session.get("targets", []))

    prs = Presentation()

    # ── Титульный слайд ──
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "Сравнение LLM-моделей"
    best_p, best_m = session.get("best_provider", ""), session.get("best_model", "")
    created = str(session.get("created_at", ""))[:10]
    subtitle_lines = [f"Сформировано: {datetime.now().strftime('%d.%m.%Y')}"]
    if created:
        subtitle_lines.append(f"Сессия от {created}")
    if best_p:
        subtitle_lines.append(f"Лучшая модель: {best_p}/{best_m}")
    slide.placeholders[1].text = "\n".join(subtitle_lines)

    # ── Условия замера ──
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Условия замера"
    tf = slide.placeholders[1].text_frame
    tf.word_wrap = True
    tf.text = f"Промпт (первые 300 симв.): {session.get('prompt', '')[:300]}"
    p = tf.add_paragraph()
    p.text = f"Транскрибация: {len(session.get('transcript', ''))} символов"
    p = tf.add_paragraph()
    p.text = f"Моделей протестировано: {len(stats)}"

    # ── Технические метрики (таблица) ──
    if stats:
        slide = prs.slides.add_slide(prs.slide_layouts[5])
        slide.shapes.title.text = "Технические метрики"
        headers = ["Модель", "Успешность", "Ср. время, с", "Мин/Медиана/Макс, с",
                   "Ток/сек", "Токены вх→вых", "Прогоны"]
        rows, cols = len(stats) + 1, len(headers)
        table = slide.shapes.add_table(
            rows, cols, Inches(0.4), Inches(1.4), Inches(9.2), Inches(0.4 + 0.35 * rows)
        ).table
        for i, h in enumerate(headers):
            table.cell(0, i).text = h
        for r, s in enumerate(stats, start=1):
            table.cell(r, 0).text = f"{s['provider']}/{s['model']}"
            table.cell(r, 1).text = f"{s['success_rate']}%"
            table.cell(r, 2).text = str(s["avg_latency_sec"])
            table.cell(r, 3).text = f"{s['min_latency_sec']}/{s['median_latency_sec']}/{s['max_latency_sec']}"
            table.cell(r, 4).text = str(s["avg_tokens_per_sec"])
            table.cell(r, 5).text = f"{s['avg_tokens_in']}→{s['avg_tokens_out']}"
            table.cell(r, 6).text = f"{s['runs_ok']}/{s['runs_total']}"
        for row in table.rows:
            for cell in row.cells:
                for para in cell.text_frame.paragraphs:
                    for run in para.runs:
                        run.font.size = Pt(11)

    # ── Отчёт судьи, порезанный на слайды ──
    for title, bullets in _report_to_slides(session.get("report", "")):
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = title[:100]
        tf = slide.placeholders[1].text_frame
        tf.word_wrap = True
        if bullets:
            tf.text = bullets[0][:500]
            for b in bullets[1:]:
                p = tf.add_paragraph()
                p.text = b[:500]

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
