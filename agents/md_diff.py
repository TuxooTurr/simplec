"""
Свод изменений между двумя версиями Markdown-документа: что добавлено, изменено, убрано — и в каком разделе.

Документ режется на блоки: заголовок, абзац, пункт списка, строка таблицы, блок кода. У каждого блока — раздел
(ближайший заголовок выше), по нему интерфейс ставит ссылку на место в документе. Блоки сравниваются как
последовательности (difflib): вставка — «добавлено», удаление — «убрано», замена — «изменено» (с прежним текстом).
"""

from __future__ import annotations

import difflib
import re
from typing import Optional

_HEAD = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")


def blocks(md: str) -> list[dict]:
    """[{text, section, level, heading}] — section: текст ближайшего заголовка выше (у заголовка — он сам)."""
    out: list[dict] = []
    section, para = "", []
    lines = (md or "").replace("\r", "").split("\n")

    def flush() -> None:
        if para:
            out.append({"text": " ".join(x.strip() for x in para).strip(), "section": section, "heading": False})
            para.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if s.startswith("```"):
            flush()
            code = [line]
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            code.append("```")
            out.append({"text": "\n".join(code), "section": section, "heading": False})
            i += 1
            continue
        m = _HEAD.match(line)
        if m:
            flush()
            section = m.group(2).strip()
            out.append({"text": section, "section": section, "heading": True, "level": len(m.group(1))})
        elif not s:
            flush()
        elif re.match(r"^\s*(?:[-*+] |\d+[.)] |\|)", line) or re.match(r"^\s*>", line):
            flush()
            sep = re.fullmatch(r"\|?[\s:|-]+\|?", s) and "-" in s          # разделитель шапки таблицы
            empty_quote = re.fullmatch(r">\s*", s)                          # пустая строка внутри цитаты
            source = re.match(r">\s*Источник:", s)                          # строка-ссылка на страницу Confluence
            if not (sep or empty_quote or source):
                out.append({"text": s, "section": section, "heading": False})
        else:
            para.append(line)
        i += 1
    flush()
    return out


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[*_`~]", "", t)).strip().lower()


def _clip(t: str, n: int = 280) -> str:
    """Текст пункта для свода — без разметки: цитата, маркер списка, ячейки таблицы через «·», жирный и код."""
    if t.startswith("```"):
        t = re.sub(r"^```\w*\n?|\n?```$", "", t)
    t = re.sub(r"^\s*>\s?", "", t)
    if t.strip().startswith("|"):
        t = " · ".join(c.strip() for c in t.strip().strip("|").split("|") if c.strip())
    t = re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?", "", t)
    t = re.sub(r"\*\*|__|`", "", t)
    t = re.sub(r"(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])", r"\1", t)   # курсив («a * b» — не курсив)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def diff(old: str, new: str) -> dict:
    """{added, changed, removed, items: [{kind, section, text, old?}]} — по порядку нового документа."""
    a, b = blocks(old), blocks(new)
    sm = difflib.SequenceMatcher(a=[_norm(x["text"]) for x in a], b=[_norm(x["text"]) for x in b], autojunk=False)
    items: list[dict] = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            continue
        if op == "insert":
            items += [{"kind": "added", "section": x["section"], "text": _clip(x["text"]), "heading": x["heading"]} for x in b[j1:j2]]
        elif op == "delete":
            # Убранное показываем там, где оно было бы в новом документе: раздел — ближайший заголовок новой версии.
            anchor = b[j1 - 1]["section"] if j1 > 0 and j1 - 1 < len(b) else (b[0]["section"] if b else "")
            items += [{"kind": "removed", "section": anchor, "was": x["section"], "text": _clip(x["text"]), "heading": x["heading"]}
                      for x in a[i1:i2]]
        else:
            olds, news = a[i1:i2], b[j1:j2]
            for k in range(max(len(olds), len(news))):
                o: Optional[dict] = olds[k] if k < len(olds) else None
                n: Optional[dict] = news[k] if k < len(news) else None
                if n and o:
                    ratio = difflib.SequenceMatcher(a=_norm(o["text"]), b=_norm(n["text"])).ratio()
                    if ratio < 0.4:     # совсем другое — это не правка, а замена: «убрано» + «добавлено»
                        items.append({"kind": "removed", "section": n["section"], "was": o["section"], "text": _clip(o["text"]), "heading": o["heading"]})
                        items.append({"kind": "added", "section": n["section"], "text": _clip(n["text"]), "heading": n["heading"]})
                    else:
                        items.append({"kind": "changed", "section": n["section"], "text": _clip(n["text"]), "old": _clip(o["text"]), "heading": n["heading"]})
                elif n:
                    items.append({"kind": "added", "section": n["section"], "text": _clip(n["text"]), "heading": n["heading"]})
                elif o:
                    items.append({"kind": "removed", "section": news[-1]["section"] if news else "", "was": o["section"],
                                  "text": _clip(o["text"]), "heading": o["heading"]})
    count = lambda k: sum(1 for x in items if x["kind"] == k)
    return {"added": count("added"), "changed": count("changed"), "removed": count("removed"), "items": items}
