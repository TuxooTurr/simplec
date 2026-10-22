"""
Справочник КЭ графика стендов (выпадающий список в форме брони) — файл data/ke_catalog.json.

Один на оба стенда и на всех, кто работает с этим SimpleTest. Новые КЭ создаются прямо из формы брони
или правятся списком в настройках стенда.

Базовый список — db/ke_catalog_default.json (лежит в репозитории). КЭ из него, которых справочник ещё не видел,
дописываются при чтении один раз: удалённый руками базовый КЭ обратно не вернётся (помним, что уже предлагали).

Запись — целиком, через временный файл: оборванная запись не оставит битый JSON.
"""

from __future__ import annotations

import json
import re
import threading
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
KE_FILE = _ROOT / "data" / "ke_catalog.json"
DEFAULT_FILE = Path(__file__).resolve().parent / "ke_catalog_default.json"
_lock = threading.Lock()


# Код КЭ: «Чат [CI04663753]», «ci04663753», «Управление приоритетными событиями (3521751)» — id опции Jira
# это тот же код без «CI» и ведущих нулей. Названия в SBER911 повторяются («Чат», «Sber911 - шлюз» — по два КЭ),
# поэтому один КЭ узнаём по коду, а без кода — по названию.
_CODE_RE = re.compile(r"(?:\bci0*(\d{5,})\b|[(\[]\s*(?:ci)?0*(\d{5,})\s*[)\]])", re.I)


def ke_key(name: str) -> str:
    """Ключ сравнения КЭ: «ci<код без нулей>», если код есть, иначе название без регистра и лишних пробелов."""
    m = _CODE_RE.search(name or "")
    if m:
        return "ci" + (m.group(1) or m.group(2))
    return " ".join((name or "").split()).lower()


_key = ke_key


def clean(names: list[str]) -> list[str]:
    """Без пустых и повторов (без учёта регистра и лишних пробелов), по алфавиту."""
    out: dict[str, str] = {}
    for n in names:
        n = " ".join(str(n).split())
        if n and _key(n) not in out:
            out[_key(n)] = n
    return sorted(out.values(), key=str.lower)


# Общая механика справочника «файл + базовый список» — ею же пользуется справочник микросервисов (db/ms_store.py).
# Пути передаются явно; у КЭ — модульные KE_FILE / DEFAULT_FILE (их подменяют тесты).

def _defaults_at(default_file: Path) -> list[str]:
    try:
        data = json.loads(default_file.read_text("utf-8"))
        return clean(data) if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _read_at(file: Path) -> dict:
    try:
        data = json.loads(file.read_text("utf-8"))
        if isinstance(data, dict) and isinstance(data.get("ke"), list):
            return {"ke": clean(data["ke"]), "seeded": [str(x) for x in data.get("seeded") or []]}
    except (OSError, ValueError):
        pass
    return {"ke": [], "seeded": []}


def _write_at(file: Path, data: dict) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(file)


def load_at(file: Path, default_file: Path) -> list[str]:
    """Справочник; новые значения из базового списка дописываются один раз."""
    with _lock:
        data = _read_at(file)
        seen = {_key(x) for x in data["seeded"]}
        fresh = [k for k in _defaults_at(default_file) if _key(k) not in seen]
        if fresh:
            data["ke"] = clean([*data["ke"], *fresh])
            data["seeded"] = [*data["seeded"], *fresh]
            _write_at(file, data)
        return data["ke"]


def add_at(file: Path, default_file: Path, names: list[str]) -> list[str]:
    """Дописать новые значения (повторы без учёта регистра пропускаются)."""
    load_at(file, default_file)
    with _lock:
        data = _read_at(file)
        data["ke"] = clean([*data["ke"], *names])
        _write_at(file, data)
        return data["ke"]


def replace_at(file: Path, default_file: Path, names: list[str]) -> list[str]:
    """Сохранить справочник целиком (правка списком)."""
    load_at(file, default_file)
    with _lock:
        data = _read_at(file)
        data["ke"] = clean(names)
        _write_at(file, data)
        return data["ke"]


def load() -> list[str]:
    return load_at(KE_FILE, DEFAULT_FILE)


def add(names: list[str]) -> list[str]:
    return add_at(KE_FILE, DEFAULT_FILE, names)


def replace(names: list[str]) -> list[str]:
    return replace_at(KE_FILE, DEFAULT_FILE, names)
