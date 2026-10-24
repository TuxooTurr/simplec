"""
Текст из PDF без сторонних библиотек — запасной путь, когда PyPDF2/pypdf не установлен, а скачать его нельзя
(корпоративная сеть без доступа в интернет).

Что умеет — то, что встречается в выгрузках Word, Confluence, браузеров и Quartz:
  • объекты PDF и потоки объектов (ObjStm, PDF 1.5+), фильтры FlateDecode (zlib), ASCIIHex, ASCII85;
  • страницы по дереву Pages (по порядку), ресурсы наследуются от родителя;
  • шрифты: ToUnicode-CMap (bfchar / bfrange, коды 1–4 байта — кириллица в Type0/CID-шрифтах), простые шрифты
    с WinAnsi/Standard и /Differences (имена глифов uniXXXX, afii100xx — кириллица);
  • операторы текста Tj, TJ, ', ", переводы строк по Td/TD/T*/Tm, пробелы по большим сдвигам в TJ;
    Form XObject (Do) — рекурсивно; встроенные картинки (BI…ID…EI) пропускаются.
Чего не умеет: сканы (текста нет — нужен OCR), шифрованные PDF, LZW. Тогда — понятная ошибка.
"""

from __future__ import annotations

import base64
import re
import zlib
from typing import Any, Optional

# ── Объекты PDF ──────────────────────────────────────────────────────────────


class Ref:
    __slots__ = ("num",)

    def __init__(self, num: int):
        self.num = num


class Name(str):
    """Имя PDF (/Font) — строка без косой черты."""


class Op(bytes):
    """Оператор потока содержимого (Tj, Tf, BT…) — в отличие от строки PDF, которая тоже bytes."""


_EOF = object()     # конец данных (None — это значение null в PDF)


class Stream:
    __slots__ = ("dict", "raw")

    def __init__(self, d: dict, raw: bytes):
        self.dict, self.raw = d, raw


_WS = b" \t\r\n\x0c\x00"
_DELIM = b"()<>[]{}/%"
_NUM_RE = re.compile(rb"[+-]?(?:\d+\.?\d*|\.\d+)")


class _Lexer:
    """Разбор объектов PDF из байтов: числа, имена, строки, массивы, словари, ссылки «n g R»."""

    def __init__(self, data: bytes, pos: int = 0):
        self.d, self.p = data, pos

    def ws(self) -> None:
        d, n = self.d, len(self.d)
        while self.p < n:
            c = d[self.p]
            if c in _WS:
                self.p += 1
            elif c == 0x25:                                   # % комментарий до конца строки
                while self.p < n and d[self.p] not in b"\r\n":
                    self.p += 1
            else:
                break

    def token(self) -> Any:
        """Следующий объект или оператор (bytes) — для потоков содержимого."""
        self.ws()
        d = self.d
        if self.p >= len(d):
            return _EOF
        c = d[self.p]
        if c == 0x2F:                                         # /Имя
            self.p += 1
            s = self.p
            while self.p < len(d) and d[self.p] not in _WS and d[self.p] not in _DELIM:
                self.p += 1
            raw = d[s:self.p]
            return Name(re.sub(rb"#([0-9A-Fa-f]{2})", lambda m: bytes([int(m[1], 16)]), raw).decode("latin-1"))
        if c == 0x28:                                         # (строка)
            return self._literal()
        if c == 0x3C:
            if d[self.p:self.p + 2] == b"<<":
                self.p += 2
                return self._dict()
            self.p += 1                                       # <hex>
            e = d.find(b">", self.p)
            e = len(d) if e < 0 else e
            hx = re.sub(rb"[^0-9A-Fa-f]", b"", d[self.p:e])
            self.p = e + 1
            if len(hx) % 2:
                hx += b"0"
            return bytes.fromhex(hx.decode())
        if c == 0x5B:                                         # [массив]
            self.p += 1
            out = []
            while True:
                self.ws()
                if self.p >= len(d) or d[self.p] == 0x5D:
                    self.p += 1
                    return out
                t = self.token()
                if t is _EOF:
                    return out
                out.append(t)
        if c in b"]>)}":
            self.p += 1
            return self.token()
        m = _NUM_RE.match(d, self.p)
        if m:
            self.p = m.end()
            txt = m.group()
            # «12 0 R» — ссылка
            save = self.p
            m2 = re.match(rb"\s+(\d+)\s+R(?![A-Za-z])", d[self.p:self.p + 24])
            if m2 and b"." not in txt and not txt.startswith((b"+", b"-")):
                self.p += m2.end()
                return Ref(int(txt))
            self.p = save
            return float(txt) if b"." in txt else int(txt)
        s = self.p                                            # оператор / ключевое слово
        while self.p < len(d) and d[self.p] not in _WS and d[self.p] not in _DELIM:
            self.p += 1
        if self.p == s:
            self.p += 1
            return self.token()
        w = d[s:self.p]
        if w in (b"true", b"false", b"null"):
            return {b"true": True, b"false": False, b"null": None}[w]
        return Op(w)

    def _literal(self) -> bytes:
        d, out, depth = self.d, bytearray(), 1
        self.p += 1
        esc = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}
        while self.p < len(d):
            c = d[self.p]
            self.p += 1
            if c == 0x5C:                                     # \
                if self.p >= len(d):
                    break
                c2 = d[self.p]
                self.p += 1
                if c2 in esc:
                    out.append(esc[c2])
                elif 0x30 <= c2 <= 0x37:                      # \ddd восьмеричное
                    o = chr(c2)
                    for _ in range(2):
                        if self.p < len(d) and 0x30 <= d[self.p] <= 0x37:
                            o += chr(d[self.p])
                            self.p += 1
                    out.append(int(o, 8) & 0xFF)
                elif c2 in b"\r\n":                           # перенос строки внутри строки
                    if c2 == 0x0D and self.p < len(d) and d[self.p] == 0x0A:
                        self.p += 1
                else:
                    out.append(c2)
            elif c == 0x28:
                depth += 1
                out.append(c)
            elif c == 0x29:
                depth -= 1
                if depth == 0:
                    break
                out.append(c)
            else:
                out.append(c)
        return bytes(out)

    def _dict(self) -> dict:
        out: dict = {}
        while True:
            self.ws()
            if self.p >= len(self.d):
                return out
            if self.d[self.p:self.p + 2] == b">>":
                self.p += 2
                return out
            k = self.token()
            if k is _EOF:
                return out
            if not isinstance(k, Name):
                continue
            v = self.token()
            out[k] = None if v is _EOF else v


# ── Документ ─────────────────────────────────────────────────────────────────

_OBJ_RE = re.compile(rb"(\d+)\s+(\d+)\s+obj\b")


def _decode(st: Stream, doc: "_Doc") -> bytes:
    filters = doc.get(st.dict.get("Filter"))
    filters = filters if isinstance(filters, list) else [filters] if filters else []
    data = st.raw
    for f in filters:
        f = doc.get(f)
        if f in ("FlateDecode", "Fl"):
            try:
                data = zlib.decompress(data)
            except zlib.error:
                data = zlib.decompressobj().decompress(data)      # оборванный поток — берём, что распаковалось
        elif f in ("ASCIIHexDecode", "AHx"):
            hx = re.sub(rb"[^0-9A-Fa-f]", b"", data.split(b">")[0])
            data = bytes.fromhex((hx + b"0" * (len(hx) % 2)).decode())
        elif f in ("ASCII85Decode", "A85"):
            body = data.strip()
            body = body[2:] if body.startswith(b"<~") else body
            data = base64.a85decode(body.split(b"~>")[0], adobe=False, ignorechars=b" \t\r\n")
        elif f in ("DCTDecode", "JPXDecode", "CCITTFaxDecode", "JBIG2Decode"):
            return b""                                            # картинка — текста нет
        else:
            raise ValueError(f"фильтр {f} не поддерживается")
    return data


class _Doc:
    def __init__(self, data: bytes):
        self.data = data
        self.objs: dict[int, Any] = {}
        # /Encrypt — в trailer (конец файла) или в словаре xref-потока (у линеаризованных — в начале).
        if re.search(rb"/Encrypt\s*(?:\d+\s+\d+\s+R|<<)", data[:8192] + data[-65536:]):
            raise ValueError("PDF зашифрован (защищён паролем)")
        for m in _OBJ_RE.finditer(data):                       # последнее определение объекта побеждает
            num = int(m[1])
            try:
                self.objs[num] = self._read(m.end())
            except Exception:
                continue
        for num, o in list(self.objs.items()):                 # потоки объектов (PDF 1.5+)
            if isinstance(o, Stream) and self.get(o.dict.get("Type")) == "ObjStm":
                try:
                    self._unpack_objstm(o)
                except Exception:
                    continue

    def _read(self, pos: int) -> Any:
        lx = _Lexer(self.data, pos)
        obj = lx.token()
        if obj is _EOF:
            return None
        if isinstance(obj, dict):
            lx.ws()
            if self.data[lx.p:lx.p + 6] == b"stream":
                s = lx.p + 6
                if self.data[s:s + 2] == b"\r\n":
                    s += 2
                elif self.data[s:s + 1] in (b"\n", b"\r"):
                    s += 1
                ln = obj.get("Length")
                e = s + ln if isinstance(ln, int) and self.data[s + ln:s + ln + 30].lstrip().startswith(b"endstream") else -1
                if e < 0:
                    e = self.data.find(b"endstream", s)
                    e = len(self.data) if e < 0 else e
                    while e > s and self.data[e - 1:e] in (b"\r", b"\n"):
                        e -= 1
                return Stream(obj, self.data[s:e])
        return obj

    def _unpack_objstm(self, st: Stream) -> None:
        data = _decode(st, self)
        n, first = int(self.get(st.dict.get("N")) or 0), int(self.get(st.dict.get("First")) or 0)
        nums = [int(x) for x in data[:first].split()]
        for i in range(0, min(len(nums), 2 * n) - 1, 2):
            num, off = nums[i], nums[i + 1]
            obj = _Lexer(data, first + off).token()
            # Объект вне потока с тем же номером — более поздняя правка файла: она важнее.
            if obj is not _EOF:
                self.objs.setdefault(num, obj)

    def get(self, v: Any, depth: int = 0) -> Any:
        while isinstance(v, Ref) and depth < 32:
            v = self.objs.get(v.num)
            depth += 1
        return v

    def pages(self) -> list[tuple[dict, dict]]:
        """Страницы по порядку: (словарь страницы, ресурсы с учётом наследования)."""
        root = None
        for o in self.objs.values():
            d = o.dict if isinstance(o, Stream) else o
            if isinstance(d, dict) and self.get(d.get("Type")) == "Catalog":
                root = self.get(d.get("Pages"))
                break
        out: list[tuple[dict, dict]] = []
        seen: set[int] = set()

        def walk(node: Any, res: dict, depth: int) -> None:
            node = self.get(node)
            if not isinstance(node, dict) or depth > 64 or id(node) in seen:
                return
            seen.add(id(node))
            r = self.get(node.get("Resources"))
            res = r if isinstance(r, dict) else res
            kids = self.get(node.get("Kids"))
            if isinstance(kids, list):
                for k in kids:
                    walk(k, res, depth + 1)
            elif self.get(node.get("Type")) == "Page" or "Contents" in node:
                out.append((node, res))

        if root is not None:
            walk(root, {}, 0)
        if not out:                                             # дерева нет или битое — все страницы, что нашлись
            for o in self.objs.values():
                if isinstance(o, dict) and self.get(o.get("Type")) == "Page":
                    out.append((o, self.get(o.get("Resources")) or {}))
        return out


# ── Шрифты: байты строки → текст ─────────────────────────────────────────────

_CYR_UP = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"
_CYR_LO = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"
_GLYPHS = {
    "space": " ", "period": ".", "comma": ",", "colon": ":", "semicolon": ";", "hyphen": "-", "endash": "–",
    "emdash": "—", "quotedblleft": "“", "quotedblright": "”", "quoteleft": "‘", "quoteright": "’",
    "guillemotleft": "«", "guillemotright": "»", "parenleft": "(", "parenright": ")", "slash": "/",
    "numbersign": "#", "percent": "%", "quotedbl": '"', "quotesingle": "'", "exclam": "!", "question": "?",
    "bullet": "•", "numero": "№", "afii61352": "№", "underscore": "_", "at": "@", "plus": "+", "equal": "=",
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
    "eight": "8", "nine": "9",
}


def _glyph(name: str) -> Optional[str]:
    if name in _GLYPHS:
        return _GLYPHS[name]
    if len(name) == 1:
        return name
    m = re.fullmatch(r"uni([0-9A-Fa-f]{4})+", name)
    if m:
        return "".join(chr(int(name[i:i + 4], 16)) for i in range(3, len(name), 4))
    m = re.fullmatch(r"u([0-9A-Fa-f]{4,6})", name)
    if m:
        return chr(int(m[1], 16))
    m = re.fullmatch(r"afii(\d{5})", name)
    if m:
        n = int(m[1])
        if 10017 <= n <= 10049:
            return _CYR_UP[n - 10017]
        if 10065 <= n <= 10097:
            return _CYR_LO[n - 10065]
    return None


def _utf16(b: bytes) -> str:
    try:
        return b.decode("utf-16-be")
    except UnicodeDecodeError:
        return b.decode("latin-1", errors="ignore")


class _Font:
    def __init__(self, doc: _Doc, font: dict):
        self.map: dict[bytes, str] = {}
        self.code_lens: list[int] = [1]
        self.simple: dict[int, str] = {}
        sub = doc.get(font.get("Subtype"))
        self.two_byte = sub == "Type0"
        # Жирный ли шрифт — для заголовков при сборке Markdown: по имени (Arial-BoldMT, ABCDEF+Calibri-Bold)
        # или по толщине из описания шрифта.
        desc = doc.get(font.get("FontDescriptor"))
        weight = doc.get(desc.get("FontWeight")) if isinstance(desc, dict) else None
        self.bold = bool(re.search(r"bold|black|heavy|semibold|demi", str(doc.get(font.get("BaseFont")) or ""), re.I)) \
            or (isinstance(weight, (int, float)) and weight >= 600)
        tu = doc.get(font.get("ToUnicode"))
        if isinstance(tu, Stream):
            try:
                self._cmap(_decode(tu, doc))
            except Exception:
                pass
        enc = doc.get(font.get("Encoding"))
        # Базовая кодировка простого шрифта: WinAnsi — cp1252, MacRoman — mac_roman (так пишет Quartz на macOS).
        base = doc.get(enc.get("BaseEncoding")) if isinstance(enc, dict) else enc
        self.codec = "mac_roman" if base == "MacRomanEncoding" else "cp1252"
        if isinstance(enc, dict):
            diffs = doc.get(enc.get("Differences"))
            code = 0
            for x in diffs if isinstance(diffs, list) else []:
                x = doc.get(x)
                if isinstance(x, int):
                    code = x
                elif isinstance(x, Name):
                    g = _glyph(str(x))
                    if g is not None:
                        self.simple[code] = g
                    code += 1
        if self.two_byte and not self.map:
            self.code_lens = [2]
        # Ширины глифов (в 1/1000 кегля) — чтобы отличить зазор между словами от стыка кусков одного слова.
        self.widths: dict[int, float] = {}
        self.default_w = 500.0
        if self.two_byte:
            desc = doc.get(font.get("DescendantFonts"))
            d0 = doc.get(desc[0]) if isinstance(desc, list) and desc else None
            if isinstance(d0, dict):
                self.default_w = float(doc.get(d0.get("DW")) or 1000)
                w = doc.get(d0.get("W"))
                items = [doc.get(x) for x in w] if isinstance(w, list) else []
                i = 0
                while i < len(items) - 1:
                    a, b = items[i], items[i + 1]
                    if isinstance(b, list):                   # c [w1 w2 …]
                        for k, wv in enumerate(b):
                            wv = doc.get(wv)
                            if isinstance(wv, (int, float)):
                                self.widths[int(a) + k] = float(wv)
                        i += 2
                    elif i + 2 < len(items) and isinstance(items[i + 2], (int, float)):   # c1 c2 w
                        if int(b) - int(a) <= 65535:
                            for c in range(int(a), int(b) + 1):
                                self.widths[c] = float(items[i + 2])
                        i += 3
                    else:
                        break
        else:
            first = doc.get(font.get("FirstChar"))
            ws = doc.get(font.get("Widths"))
            if isinstance(first, int) and isinstance(ws, list):
                for k, wv in enumerate(ws):
                    wv = doc.get(wv)
                    if isinstance(wv, (int, float)):
                        self.widths[first + k] = float(wv)

    def _cmap(self, data: bytes) -> None:
        lens = set()
        for body in re.findall(rb"begincodespacerange(.*?)endcodespacerange", data, re.S):
            for lo, _hi in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", body):
                lens.add(len(lo) // 2)
        for body in re.findall(rb"beginbfchar(.*?)endbfchar", data, re.S):
            for src, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", body):
                self.map[bytes.fromhex(src.decode())] = _utf16(bytes.fromhex(dst.decode()))
                lens.add(len(src) // 2)
        for body in re.findall(rb"beginbfrange(.*?)endbfrange", data, re.S):
            for lo, hi, rest in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]*>)", body):
                a, b, n = int(lo, 16), int(hi, 16), len(lo) // 2
                lens.add(n)
                if b - a > 65535:
                    continue
                if rest.startswith(b"["):
                    for i, dst in enumerate(re.findall(rb"<([0-9A-Fa-f]*)>", rest)):
                        self.map[(a + i).to_bytes(n, "big")] = _utf16(bytes.fromhex(dst.decode()))
                else:
                    base = bytes.fromhex(rest[1:-1].decode())
                    for i in range(b - a + 1):
                        # Прибавляем к последнему символу назначения (UTF-16BE).
                        v = int.from_bytes(base, "big") + i
                        self.map[(a + i).to_bytes(n, "big")] = _utf16(v.to_bytes(max(2, len(base)), "big"))
        if lens:
            self.code_lens = sorted(lens, reverse=True)

    def codes(self, s: bytes) -> list[bytes]:
        """Строка → коды символов: у Type0 — по 2 байта (или по длинам из CMap), у простых — по байту."""
        if not self.two_byte and not self.map:
            return [s[i:i + 1] for i in range(len(s))]
        out, i = [], 0
        while i < len(s):
            for n in self.code_lens:
                if s[i:i + n] in self.map:
                    break
            else:
                n = 2 if self.two_byte else 1
            out.append(s[i:i + n])
            i += n
        return out

    def text(self, s: bytes) -> tuple[str, float]:
        """Текст строки и её ширина в 1/1000 кегля."""
        chars, width = [], 0.0
        for c in self.codes(s):
            n = int.from_bytes(c, "big")
            width += self.widths.get(n, self.default_w)
            if self.map:
                chars.append(self.map.get(c, ""))
            elif self.two_byte:                               # CID без ToUnicode — коды часто совпадают с Unicode
                chars.append(chr(n) if len(c) == 2 else "")
            else:
                chars.append(self.simple.get(n) or c.decode(self.codec, errors="ignore"))
        return "".join(chars), width


# ── Содержимое страницы ──────────────────────────────────────────────────────

_TEXT_OPS = {b"Tj", b"TJ", b"'", b'"'}


def _content_text(doc: _Doc, data: bytes, res: dict, fonts_cache: dict, depth: int = 0,
                  spans: Optional[list] = None) -> str:
    """Текст потока содержимого. spans — если передан, сюда параллельно выводу пишутся куски
    (текст, кегль на странице, жирный ли, вертикаль строки, начало куска по горизонтали); пробел и перевод
    строки — с кеглем None.
    По ним собирается Markdown (pdf_markdown)."""
    fonts = doc.get(res.get("Font")) if isinstance(res, dict) else None
    fonts = fonts if isinstance(fonts, dict) else {}
    xobjs = doc.get(res.get("XObject")) if isinstance(res, dict) else None
    xobjs = xobjs if isinstance(xobjs, dict) else {}

    def font(name: Any) -> Optional[_Font]:
        ref = fonts.get(name)
        key = ref.num if isinstance(ref, Ref) else id(ref)
        if key not in fonts_cache:
            f = doc.get(ref)
            fonts_cache[key] = _Font(doc, f) if isinstance(f, dict) else None
        return fonts_cache[key]

    lx = _Lexer(data)
    out: list[str] = []
    args: list[Any] = []
    cur: Optional[_Font] = None
    size = 1.0
    # Положение по горизонтали в пространстве страницы: начало строки текста и конец уже выведенного текста.
    # Следующий кусок начинается заметно правее конца предыдущего — между ними пробел; вплотную — то же слово.
    scale = 1.0
    line_x = 0.0                       # начало текущей строки текста (Td, Tm)
    pos: Optional[float] = None        # куда встанет следующий символ
    end_x: Optional[float] = None      # где закончился последний выведенный текст
    y: Optional[float] = None
    ty, leading = 0.0, 0.0             # вертикаль текущей строки и интерлиньяж (TL) — абзацы при сборке Markdown

    def newline() -> None:
        if out and not out[-1].endswith("\n"):
            out.append("\n")
            if spans is not None:
                spans.append(("\n", None, False, ty, 0.0))

    def space() -> None:
        if out and not out[-1].endswith((" ", "\n")):
            out.append(" ")
            if spans is not None:
                spans.append((" ", None, False, ty, 0.0))

    def gap(start: float) -> None:
        """Новый кусок текста с позиции start: зазор от конца предыдущего больше ~пятой кегля — пробел."""
        if end_x is not None and start - end_x > 0.2 * size * scale:
            space()

    while True:
        t = lx.token()
        if t is _EOF:
            break
        if not isinstance(t, Op):
            args.append(t)
            continue
        op = t
        if op == b"BI":                                       # встроенная картинка: пропускаем данные до EI
            e = data.find(b"EI", data.find(b"ID", lx.p))
            lx.p = len(data) if e < 0 else e + 2
        elif op == b"Tf" and args:
            cur = font(args[0] if len(args) < 2 else args[-2])
            if isinstance(args[-1], (int, float)) and args[-1]:
                size = abs(float(args[-1]))
        elif op == b"TL" and args and isinstance(args[-1], (int, float)):
            leading = args[-1] * scale
        elif op in (b"Td", b"TD") and len(args) >= 2 and isinstance(args[1], (int, float)) and isinstance(args[0], (int, float)):
            line_x += args[0] * scale
            ty += args[1] * scale
            if op == b"TD":
                leading = -args[1] * scale
            if abs(args[1]) > 0.5:                            # сдвиг по вертикали — новая строка
                newline()
                end_x = None
            else:
                gap(line_x)
            pos = line_x
        elif op == b"T*":
            newline()
            end_x, pos = None, line_x
            ty -= leading or size * scale * 1.2
        elif op == b"Tm" and len(args) >= 6 and all(isinstance(a, (int, float)) for a in args[-6:]):
            a, _b, _c, _d, e, f = args[-6:]
            scale = abs(a) or 1.0
            if y is not None and abs(f - y) > 0.5:
                newline()
                end_x = None
            else:
                gap(e)
            line_x, pos, y, ty = e, e, f, f
        elif op == b"BT":
            line_x, pos, scale, ty = 0.0, None, 1.0, 0.0
        elif op in _TEXT_OPS and args:
            if op in (b"'", b'"'):
                newline()
                ty -= leading or size * scale * 1.2
            arg = args[-1]
            items = arg if isinstance(arg, list) else [arg]
            x = line_x if pos is None else pos
            for it in items:
                x0 = x
                if isinstance(it, bytes) and not isinstance(it, Op):
                    txt, w = cur.text(it) if cur else (it.decode("latin-1", errors="ignore"), 500.0 * len(it))
                    if spans is not None:
                        spans.append((txt, size * scale, bool(cur and cur.bold), ty, x0))
                    out.append(txt)
                    x += w / 1000 * size * scale
                elif isinstance(it, (int, float)):
                    if it < -200:
                        space()                               # большой сдвиг в TJ — пробел между словами
                    x -= it / 1000 * size * scale
            end_x = pos = x
        elif op == b"Do" and args and depth < 4:
            xo = doc.get(xobjs.get(args[-1]))
            if isinstance(xo, Stream) and doc.get(xo.dict.get("Subtype")) == "Form":
                try:
                    sub_res = doc.get(xo.dict.get("Resources"))
                    newline()
                    out.append(_content_text(doc, _decode(xo, doc), sub_res if isinstance(sub_res, dict) else res, fonts_cache,
                                             depth + 1, spans))
                    newline()
                except Exception:
                    pass
        args = []
    text = "".join(out)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"[ \t]{2,}", " ", text)


def _page_streams(data: bytes) -> tuple[_Doc, list[tuple[bytes, dict]]]:
    """Документ и по каждой странице — склеенный поток содержимого и ресурсы."""
    if not data.lstrip()[:5].startswith(b"%PDF"):
        raise ValueError("это не PDF")
    doc = _Doc(data)
    pages = doc.pages()
    if not pages:
        raise ValueError("в PDF не нашлось страниц")
    out = []
    for page, res in pages:
        contents = doc.get(page.get("Contents"))
        parts = contents if isinstance(contents, list) else [contents]
        buf = b""
        for c in parts:
            c = doc.get(c)
            if isinstance(c, Stream):
                try:
                    buf += _decode(c, doc) + b"\n"
                except Exception:
                    continue
        out.append((buf, res))
    return doc, out


def extract_pages(data: bytes) -> list[str]:
    """Текст по страницам. Не PDF, зашифрован или битый так, что страниц не найти — ValueError."""
    doc, pages = _page_streams(data)
    cache: dict = {}
    return [_content_text(doc, buf, res, cache).strip() for buf, res in pages]


# ── PDF → Markdown ───────────────────────────────────────────────────────────
#
# Разметки в PDF нет — только куски текста с кеглем, шрифтом и положением. Структура восстанавливается по ним:
#   • основной кегль — тот, которым набрана бо́льшая часть символов; строки заметно крупнее — заголовки
#     (самый крупный кегль — «#», следующий — «##», третий — «###»);
#   • короткая строка целиком жирным основным кеглем — заголовок уровнем ниже крупных («Примечание:» с двоеточием
#     в конце — жирный абзац, а не заголовок);
#   • маркеры •, –, -, * и «1.» / «1)» в начале строки — пункты списка;
#   • строки абзаца склеиваются (PDF переносит строки по ширине страницы), новый абзац — по увеличенному
#     вертикальному зазору; перенос слова с дефисом в конце строки склеивается без дефиса;
#   • колонтитулы — строки, повторяющиеся вверху или внизу большинства страниц, и номера страниц — выкидываются.
# Таблицы восстановить не из чего — их строки остаются обычным текстом.

class _Line:
    __slots__ = ("text", "size", "bold", "y", "x")

    def __init__(self, text: str, size: Optional[float], bold: bool, y: float, x: float):
        self.text, self.size, self.bold, self.y, self.x = text, size, bold, y, x


def _lines(spans: list) -> list[_Line]:
    """Куски текста → строки: кегль строки — у большинства её символов, жирная — если жирные все буквы."""
    out: list[_Line] = []
    buf: list[tuple] = []

    def close() -> None:
        text = re.sub(r"\s+", " ", "".join(t for t, *_ in buf)).strip()
        if text:
            weight: dict[float, int] = {}
            letters = bold = 0
            for t, sz, b, *_ in buf:
                n = sum(1 for ch in t if not ch.isspace())
                if sz is not None and n:
                    weight[round(sz * 2) / 2] = weight.get(round(sz * 2) / 2, 0) + n
                    letters += n
                    bold += n if b else 0
            size = max(weight, key=weight.get) if weight else None
            first = next((sp for sp in buf if sp[1] is not None and sp[0].strip()), buf[0])
            out.append(_Line(text, size, bool(letters) and bold == letters, first[3], first[4]))
        buf.clear()

    for sp in spans:
        if sp[0] == "\n":
            close()
        else:
            buf.append(sp)
    close()
    return out


# Маркеры: обычные и из шрифтов Symbol/Wingdings, которыми Word рисует списки (U+F0B7, U+F0A7, U+F076, U+F0D8).
_BULLET_RE = re.compile(r"^(?:[•●▪◦‣∙·○■□➢►✓✔\uf0b7\uf0a7\uf076\uf0d8]\s*|[-–—*]\s+)(?=\S)")
_NUM_RE_MD = re.compile(r"^(\d{1,2})[.)]\s+(?=\S)")
_PAGE_NO_RE = re.compile(r"^(?:(?:стр\.?|страница|page|p\.)\s*)?\d{1,4}(?:\s*(?:из|/|of)\s*\d{1,4})?$", re.I)


def _drop_running(pages: list[list[_Line]]) -> list[list[_Line]]:
    """Без колонтитулов (повторяются вверху/внизу на большинстве страниц; цифры не в счёт) и номеров страниц."""
    norm = lambda t: re.sub(r"\d+", "#", t.lower())
    edge: dict[str, int] = {}
    for lines in pages:
        for t in {norm(l.text) for l in lines[:2] + lines[-2:]}:
            edge[t] = edge.get(t, 0) + 1
    repeated = {t for t, n in edge.items() if len(pages) >= 3 and n >= max(3, len(pages) * 0.6)}
    out = []
    for lines in pages:
        keep = []
        for i, l in enumerate(lines):
            at_edge = i < 2 or i >= len(lines) - 2
            if at_edge and (norm(l.text) in repeated or _PAGE_NO_RE.match(l.text)):
                continue
            keep.append(l)
        out.append(keep)
    return out


def _join(a: str, b: str) -> str:
    """Склейка перенесённых строк: «инфор-» + «мация» → «информация», иначе через пробел."""
    if re.search(r"[A-Za-zА-Яа-яЁё]-$", a) and b[:1].islower():
        return a[:-1] + b
    return a + " " + b


def pdf_markdown(data: bytes) -> str:
    """PDF → Markdown: заголовки по кеглю и жирности, списки, абзацы. Ошибки — как у extract_pages."""
    doc, streams = _page_streams(data)
    cache: dict = {}
    pages: list[list[_Line]] = []
    for buf, res in streams:
        spans: list = []
        _content_text(doc, buf, res, cache, spans=spans)
        pages.append(_lines(spans))
    pages = _drop_running(pages)
    lines = [l for p in pages for l in p]
    if not lines:
        return ""

    # Основной кегль — по числу символов.
    weight: dict[float, int] = {}
    for l in lines:
        if l.size is not None:
            weight[l.size] = weight.get(l.size, 0) + len(l.text)
    body = max(weight, key=weight.get) if weight else 0.0
    big = sorted({l.size for l in lines if l.size and body and l.size >= body * 1.12 and len(l.text) <= 150}, reverse=True)[:3]
    level = {sz: i + 1 for i, sz in enumerate(big)}
    bold_level = min(len(big) + 1, 4)

    # Обычный межстрочный зазор основного текста — чтобы отличить перенос строки от нового абзаца.
    # Самый частый зазор (а не медиана): строк внутри абзацев больше, чем промежутков между блоками.
    gap_n: dict[float, int] = {}
    for p in pages:
        for a, b in zip(p, p[1:]):
            g = round(abs(b.y - a.y) * 2) / 2
            if a.size == body and b.size == body and 0 < g < body * 4:
                gap_n[g] = gap_n.get(g, 0) + 1
    line_gap = min(gap_n, key=lambda g: (-gap_n[g], g)) if gap_n else 0.0

    # Списки, у которых маркер нарисован картинкой (Chrome, браузеры), видны только по отступу: строки пункта
    # сдвинуты вправо от левого края текста. Но и абзац «с красной строки» (Word) начинается с отступа — у него
    # продолжение уже без отступа. Если таких абзацев в документе хотя бы два, отступ списком не считаем.
    xs: dict[float, int] = {}
    for l in lines:
        if l.size == body:
            xs[round(l.x)] = xs.get(round(l.x), 0) + len(l.text)
    margin = min((x for x, n in xs.items() if n >= max(xs.values()) * 0.3), default=0.0) if xs else 0.0
    indented = lambda l: l.size == body and body > 0 and l.x >= margin + body * 0.8
    red_line = sum(1 for pg in pages for a, b in zip(pg, pg[1:])
                   if indented(a) and b.size == body and not indented(b) and line_gap and abs(b.y - a.y) <= line_gap * 1.5)
    use_indent = red_line < 2

    blocks: list[str] = []
    para = ""            # текущий абзац или пункт списка
    para_indent = False  # текущий пункт распознан по отступу
    last_text = ""       # последняя строка предыдущей страницы
    for p in pages:
        prev: Optional[_Line] = None
        for l in p:
            t = l.text
            heading = 0
            if l.size in level:
                heading = level[l.size]
            elif l.bold and l.size == body and len(t) <= 100 and not re.search(r"[.;,]$", t) and re.search(r"[^\W\d_]", t):
                heading = -1 if t.endswith(":") else bold_level
            bullet = _BULLET_RE.match(t)
            num = _NUM_RE_MD.match(t)
            gap = abs(l.y - prev.y) if prev is not None else 0.0
            if prev is None:
                # Первая строка страницы: абзац с прошлой страницы продолжается, если там фраза не закончилась.
                new_para = not last_text or bool(re.search(r"[.!?:;»\"]$", last_text))
            else:
                new_para = not line_gap or gap > line_gap * 1.5 or gap == 0
            prev_text = prev.text if prev is not None else last_text
            prev = l
            if heading or bullet or num:
                if para:
                    blocks.append(para)
                    para = ""
                para_indent = False
                if heading > 0:
                    # Заголовок, перенесённый на две строки, — одной строкой.
                    if blocks and blocks[-1].startswith("#" * heading + " ") and not new_para:
                        blocks[-1] = _join(blocks[-1], t)
                    else:
                        blocks.append("#" * heading + " " + t)
                elif heading < 0:
                    blocks.append("**" + t + "**")
                elif bullet:
                    para = "- " + t[bullet.end():]
                else:
                    para = num.group(1) + ". " + t[num.end():]
                continue
            if use_indent and indented(l):
                starts = not para_indent or new_para or (re.search(r"[.;!?]$", prev_text) and re.match(r"[«\"(]?[A-ZА-ЯЁ0-9]", t))
                if starts:
                    if para:
                        blocks.append(para)
                    para, para_indent = "- " + t, True
                else:
                    para = _join(para, t)
                continue
            if para_indent:               # строка без отступа после пунктов — список кончился
                blocks.append(para)
                para, para_indent = t, False
                continue
            if not use_indent and indented(l):   # документ «с красной строки»: отступ и есть начало абзаца
                new_para = True
            if para and not new_para:
                para = _join(para, t)
            elif para and para.startswith(("- ",)) and gap and gap <= line_gap * 1.5:
                para = _join(para, t)
            else:
                if para:
                    blocks.append(para)
                para = t
        if p:
            last_text = p[-1].text
    if para:
        blocks.append(para)

    # Пункты списка подряд — без пустой строки между ними, остальное — через пустую строку.
    out: list[str] = []
    for b in blocks:
        is_item = b.startswith("- ") or bool(re.match(r"\d+\. ", b))
        if out and not (is_item and (out[-1].startswith("- ") or re.match(r"\d+\. ", out[-1]))):
            out.append("")
        out.append(b)
    return "\n".join(out).strip()
