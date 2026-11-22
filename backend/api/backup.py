"""
Резервная копия данных Shark — выгрузка в один .json и восстановление из него.

Зачем: данные живут внутри папки установки (data/*.json, simpletest.db). Переустановка «удалить
папку → поставить заново» стирает их. Перед переустановкой — «Выгрузить всё», после — «Загрузить из файла».

Что входит (раздел = вкладка приложения; выгрузить можно один раздел или все):
  • файлы data/*.json — все, что есть (новые хранилища попадают в выгрузку сами, без правки этого модуля);
  • таблицы БД — настройки (metrics_settings), Метрики ОД, журнал генераций;
  • рисунки документов «Данных» (data/requirement_assets) — содержимым в base64, раздел «Данные»;
  • браузерные данные (localStorage) кладёт в файл фронт — бэкенд их не видит.
Эталоны RAG (ChromaDB) упразднены: ключ server["etalons"] из старых копий при восстановлении пропускается.
Не входят: кэши, которые собираются заново (индекс Zephyr), JAR-драйверы JDBC, сертификаты и ключи.

Секреты (токены, пароли, ключи API) в файл не попадают: значение заменяется меткой REDACTED. При восстановлении
на месте метки остаётся то, что уже сохранено на этом Shark (пароль подключения с тем же id, токен Jira…);
нечего оставить — поле пустое, его вводят заново.

При загрузке выбирается режим. По умолчанию merge дописывает недостающее, сохраняя существующие значения;
replace заменяет представленные в копии файлы/таблицы и значения ключей настроек. Отсутствующие хранилища
и невыбранные разделы не трогаются. В merge папки «Данных» сопоставляются также по пути, записи коллекций —
по id/key/name. Главная переносится с раскладкой, настройками и очередями; её версия обновляется, новые
виджеты размещаются без наложения на существующие. Перед восстановлением данные сервера сохраняются
в data/backups/ (последние 5). Сбой одного хранилища не обрывает остальные: он попадает в errors.

Эндпоинты:
  GET  /api/backup/sections         — разделы и что в них есть сейчас
  GET  /api/backup/export?scope=…   — выгрузка: all или id раздела (generation, bugs, …)
  POST /api/backup/import           — восстановление: {backup, sections?: [id…], mode?: "merge" | "replace"}
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Optional
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, Integer, Table, UniqueConstraint, text
from sqlalchemy.orm import Session

from backend.api.auth import require_superuser, require_user
from db.metrics_models import Base
from db.postgres import get_db
from db.paths import DATA_DIR
from backend.backup_merge import merge_missing

# Вся выгрузка и восстановление — только суперюзеру: в файле все данные приложения.
router = APIRouter(dependencies=[Depends(require_superuser)])

FORMAT = "simpletest.backup"
VERSION = 1
REDACTED = "__SIMPLETEST_REDACTED__"
_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = DATA_DIR
BACKUPS_DIR = DATA_DIR / "backups"
KEEP_SNAPSHOTS = 5
RESTORE_LOCK = threading.RLock()

# Разделы — как вкладки в меню. Файл, таблица или ключ настроек относится к одному разделу; не найденное — в «Общее».
SECTIONS: dict[str, str] = {
    "dashboard": "Главная",
    "generation": "Тестовая модель",
    "test_data": "Тестовые данные",
    "bugs": "Jira tool",
    "zephyr": "Zephyr Tool",
    "stands": "График стендов",
    "logs": "Логи",
    "kafka": "Просмотр Kafka",
    "event_generators": "Генераторы событий",
    "etalons": "Данные",
    "model_bench": "Тестирование моделей LLM",
    "aqa": "Трекинг AQA",
    "auto_model": "Автотесты",
    "settings": "Настройки и общее",
}

FILE_SECTION: dict[str, str] = {
    "dashboard.json": "dashboard", "ether_cookies.json": "dashboard", "ether_owner.json": "dashboard",
    "gen_sessions.json": "generation",
    "testdata_connections.json": "test_data", "datagen_config.json": "test_data", "jdbc_drivers.json": "test_data",
    "people.json": "bugs", "jira_views.json": "bugs",
    "zephyr_releases.json": "zephyr",
    "ke_catalog.json": "stands", "ms_catalog.json": "stands",
    "log_services.json": "logs", "web_connectors.json": "logs",
    "kafka_explorer_connections.json": "kafka",
    "alert_scripts.json": "event_generators", "alert_folders.json": "event_generators", "jobs.json": "event_generators",
    "job_folders.json": "event_generators", "job_history.json": "event_generators", "hub_tiles.json": "event_generators",
    "kernel_audit.json": "event_generators", "teams.json": "event_generators", "incident_gen.json": "event_generators",
    "requirements.json": "etalons", "requirement_folders.json": "etalons", "requirement_folders_seeded.json": "etalons",
    "model_bench_scenarios.json": "model_bench", "model_bench_sessions.json": "model_bench",
    "autotest_run_config.json": "auto_model", "autotest_run_history.json": "auto_model",
    "aqa_roadmap.json": "aqa",
}
TABLE_SECTION: dict[str, str] = {
    "test_systems": "event_generators", "test_metrics": "event_generators", "test_metric_values_config": "event_generators",
    "test_metric_baseline_config": "event_generators", "test_metric_thresholds_config": "event_generators",
    "test_metric_threshold_rows": "event_generators", "test_metric_health_config": "event_generators",
    "generation_log": "generation",
    "metrics_settings": "settings",          # ключи раскладываются по разделам: SETTING_PREFIX
}
SETTING_PREFIX: list[tuple[str, str]] = [
    ("jira_", "bugs"), ("confluence_", "stands"), ("stands_", "stands"), ("zephyr_", "zephyr"),
    ("logs_", "logs"), ("revisor_", "auto_model"), ("kafka_", "kafka"), ("tcs_", "event_generators"), ("aqa_", "aqa"),
]
SETTINGS_TABLE = "metrics_settings"
# id раздела «Данные» — прежнее имя сохранено ради совместимости файлов копий.
ETALONS = "etalons"

_SECRET_KEY = re.compile(r"(pass(word|wd)?|pwd|secret|token|api_?key|auth_?key|private|credential|cookie|sasl_password)", re.I)


def is_secret(name: str) -> bool:
    """Имя поля или ключа настроек — секрет. Путь к файлу с токеном (…_path) — не секрет, его переносим."""
    n = name.lower()
    return bool(_SECRET_KEY.search(n)) and not n.endswith("path") and not n.endswith("_type")


def redact(value: Any) -> Any:
    """Секретные строковые поля на любой глубине → REDACTED. Пустые остаются пустыми (восстанавливать нечего),
    числа не трогаем: «max_tokens», «prompt_tokens» — счётчики, а не секреты."""
    if isinstance(value, dict):
        return {k: (REDACTED if is_secret(k) and isinstance(v, str) and v else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def _item_key(x: Any) -> Optional[str]:
    if isinstance(x, dict):
        for k in ("id", "key", "name"):
            if isinstance(x.get(k), (str, int)) and x.get(k) != "":
                return f"{k}:{x[k]}"
    return None


def unredact(new: Any, old: Any) -> Any:
    """Метки REDACTED → значения, уже сохранённые здесь по тому же пути; элементы списков сопоставляются по id/key/name."""
    if new == REDACTED:
        return old if isinstance(old, str) and old != REDACTED else ""
    if isinstance(new, dict):
        o = old if isinstance(old, dict) else {}
        return {k: unredact(v, o.get(k)) for k, v in new.items()}
    if isinstance(new, list):
        olds = old if isinstance(old, list) else []
        by_key = {k: x for x in olds if (k := _item_key(x))}
        out = []
        for i, v in enumerate(new):
            k = _item_key(v)
            out.append(unredact(v, by_key.get(k) if k else (olds[i] if i < len(olds) else None)))
        return out
    return new


def setting_section(key: str) -> str:
    return next((s for p, s in SETTING_PREFIX if key.startswith(p)), "settings")


def _redact_setting(key: str, value: Optional[str]) -> Optional[str]:
    if value in ("", None):
        return value
    if is_secret(key):
        return REDACTED
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return value
    return json.dumps(redact(parsed), ensure_ascii=False) if isinstance(parsed, (dict, list)) else value


def _unredact_setting(new: Optional[str], old: Optional[str]) -> Optional[str]:
    if new == REDACTED:
        return old or ""
    if not new or REDACTED not in new:
        return new
    try:
        parsed, before = json.loads(new), json.loads(old) if old else None
    except (TypeError, ValueError):
        return new
    return json.dumps(unredact(parsed, before), ensure_ascii=False)


# ── Сбор ─────────────────────────────────────────────────────────────────────

def _data_files() -> list[Path]:
    return sorted(p for p in DATA_DIR.glob("*.json") if p.is_file())


def _wanted(section: str, scope: str) -> bool:
    return scope == "all" or section == scope


def _tables() -> dict[str, Table]:
    return {t.name: t for t in Base.metadata.sorted_tables}


def _row(table: Table, r: Any) -> dict:
    out = {}
    for c in table.columns:
        v = getattr(r, c.name)
        out[c.name] = v.isoformat() if isinstance(v, datetime) else v
    return out


ASSETS_DIR_NAME = "requirement_assets"
_ASSET_NAME = re.compile(r"^[0-9a-f]{20}\.(png|jpg|gif|webp|svg)$")


def _assets_dump() -> dict[str, str]:
    """Рисунки документов «Данных»: имя файла → содержимое в base64 (имя — хэш содержимого, совпадения не дублируются)."""
    import base64
    folder = DATA_DIR / ASSETS_DIR_NAME
    if not folder.is_dir():
        return {}
    return {p.name: base64.b64encode(p.read_bytes()).decode("ascii")
            for p in sorted(folder.iterdir()) if p.is_file() and _ASSET_NAME.match(p.name)}


def collect(db: Session, scope: str = "all", secrets: bool = False) -> dict:
    """Данные сервера для выгрузки. secrets=True — только для локального снимка перед восстановлением."""
    if scope != "all" and scope not in SECTIONS:
        raise HTTPException(422, f"Неизвестный раздел: {scope}")
    clean = (lambda v: v) if secrets else redact
    files: dict[str, Any] = {}
    skipped: list[str] = []
    for p in _data_files():
        if not _wanted(FILE_SECTION.get(p.name, "settings"), scope):
            continue
        try:
            files[p.name] = clean(json.loads(p.read_text("utf-8")))
        except (OSError, ValueError) as e:
            skipped.append(f"{p.name}: {e}"[:200])
    tables: dict[str, list[dict]] = {}
    for name, table in _tables().items():
        section = TABLE_SECTION.get(name, "settings")
        if name == SETTINGS_TABLE:
            rows = [_row(table, r) for r in db.execute(table.select()).fetchall()]
            rows = [r for r in rows if _wanted(setting_section(r["key"]), scope)]
            if not secrets:
                rows = [{**r, "value": _redact_setting(r["key"], r["value"])} for r in rows]
            if rows:
                tables[name] = rows
        elif _wanted(section, scope):
            tables[name] = [_row(table, r) for r in db.execute(table.select()).fetchall()]
    out: dict[str, Any] = {"files": files, "tables": tables}
    if _wanted(ETALONS, scope):
        assets = _assets_dump()
        if assets:
            out["assets"] = assets
    return {**out, "skipped": skipped}


def summary(server: dict) -> list[dict]:
    """Что лежит в выгрузке по разделам: [{id, title, files, tables, settings, assets}] — для окна восстановления."""
    acc: dict[str, dict] = {}

    def at(s: str) -> dict:
        return acc.setdefault(s, {"id": s, "title": SECTIONS.get(s, s), "files": [], "tables": [], "settings": 0, "assets": 0})
    for name in server.get("files", {}):
        at(FILE_SECTION.get(name, "settings"))["files"].append(name)
        if name == 'dashboard.json':
            data = server['files'][name]
            widgets = data.get('widgets') or [] if isinstance(data, dict) else []
            widgets = [w for w in widgets if isinstance(w, dict)] if isinstance(widgets, list) else []
            shared = [w for w in widgets if w.get('scope') != 'personal']
            at('dashboard')['widgets'] = sum(w.get('kind') != 'counter' for w in shared)
            at('dashboard')['counters'] = sum(w.get('kind') == 'counter' for w in shared)
            at('dashboard')['personal'] = len(widgets) - len(shared)
    for name, rows in server.get("tables", {}).items():
        if name == SETTINGS_TABLE:
            for r in rows:
                at(setting_section(r["key"]))["settings"] += 1
        else:
            at(TABLE_SECTION.get(name, "settings"))["tables"].append(f"{name} ({len(rows)})")
    if server.get("assets"):
        at(ETALONS)["assets"] = len(server["assets"])
    return [acc[s] for s in SECTIONS if s in acc]


# ── Восстановление ───────────────────────────────────────────────────────────

def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as tmp:
        try:
            json.dump(value, tmp, ensure_ascii=False, indent=2)
            tmp.close()
            os.replace(tmp.name, path)
        finally:
            if os.path.exists(tmp.name): os.unlink(tmp.name)


def _parse_dt(table: Table, row: dict) -> dict:
    out = {}
    for c in table.columns:
        if c.name not in row:
            continue
        v = row[c.name]
        if isinstance(c.type, DateTime) and isinstance(v, str) and v:
            try:
                v = datetime.fromisoformat(v)
            except ValueError:
                v = None
        out[c.name] = v
    return out


def _fix_sequence(db: Session, table: Table) -> None:
    """PostgreSQL: строки вставлены со своими id — счётчик id двигаем за максимум, иначе следующая запись упадёт."""
    if db.get_bind().dialect.name != "postgresql" or "id" not in table.c:
        return
    db.execute(text(f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {table.name}), 1))"))


def _snapshot(db: Session) -> str:
    """Текущие данные (с секретами — файл не покидает сервер) → data/backups/; хранится последние KEEP_SNAPSHOTS."""
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    path = BACKUPS_DIR / f"before-restore-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.json"
    _write_json(path, {"format": FORMAT, "version": VERSION, "createdAt": datetime.now().isoformat(timespec="seconds"),
                       "scope": "all", "secrets": "included", "server": collect(db, "all", secrets=True)})
    for old in sorted(BACKUPS_DIR.glob("before-restore-*.json"))[:-KEEP_SNAPSHOTS]:
        old.unlink(missing_ok=True)
    try: return str(path.relative_to(_ROOT))
    except ValueError: return f'backups/{path.name}'


REQ_FOLDERS, REQ_DOCS, REQ_SEEDED = "requirement_folders.json", "requirements.json", "requirement_folders_seeded.json"
MERGED_FILES = (REQ_FOLDERS, REQ_DOCS, REQ_SEEDED)


def _dicts(value: Any) -> list[dict]:
    return [x for x in value if isinstance(x, dict) and x.get("id")] if isinstance(value, list) else []


def merge_folders(current: list[dict], incoming: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """Папки «Данных» из копии → в текущее дерево, ничего в нём не меняя. Папка с тем же id или с тем же именем
    у того же родителя — уже есть (базовое дерево на разных машинах заводит одинаковые папки с разными id);
    остальные дописываются. Возвращает дерево и соответствие id папок копии → id папок здесь."""
    out = list(current)
    have = {f["id"] for f in out}
    src = {f["id"]: f for f in incoming}
    idmap: dict[str, str] = {}

    def place(f: dict, chain: frozenset) -> str:
        fid = f["id"]
        if fid in idmap:
            return idmap[fid]
        if fid in have:                       # та же папка: её место и имя — как сейчас
            idmap[fid] = fid
            return fid
        pid = f.get("parent_id") or ""
        if pid in src and pid not in chain:
            parent = place(src[pid], chain | {fid})
        else:
            parent = pid if pid in have else ""
        name = str(f.get("name", "")).strip().lower()
        same = next((x for x in out if (x.get("parent_id") or "") == parent
                     and str(x.get("name", "")).strip().lower() == name), None)
        if same is not None:
            idmap[fid] = same["id"]
        else:
            out.append({**f, "parent_id": parent})
            have.add(fid)
            idmap[fid] = fid
        return idmap[fid]

    for f in incoming:
        place(f, frozenset())
    return out, idmap


def merge_requirements(current: list[dict], incoming: list[dict], idmap: dict[str, str], folder_ids: set[str]) -> list[dict]:
    """Add new documents with remapped folder ids; existing documents remain unchanged."""
    out = list(current)
    pos = {d["id"]: i for i, d in enumerate(out)}
    for doc in incoming:
        fid = idmap.get(doc.get("folder_id") or "", doc.get("folder_id") or "")
        if doc["id"] not in pos:
            pos[doc['id']] = len(out)
            out.append({**doc, "folder_id": fid if fid in folder_ids else ""})
            continue
    return out


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text("utf-8")) if path.exists() else None
    except (OSError, ValueError):
        return None


def _current_json(path: Path) -> Any:
    return json.loads(path.read_text('utf-8')) if path.exists() else None


def _restore_requirements(files: dict, done: dict, errors: list[str]) -> None:
    """Раздел «Данные»: дерево и документы сливаются с текущими, а не заменяют их."""
    try:
        folders_now = _dicts(_current_json(DATA_DIR / REQ_FOLDERS))
        folders, idmap = merge_folders(folders_now, _dicts(files.get(REQ_FOLDERS)))
        if REQ_FOLDERS in files:
            _write_json(DATA_DIR / REQ_FOLDERS, folders)
            done["files"].append(REQ_FOLDERS)
        if REQ_DOCS in files:
            docs_now = _dicts(_current_json(DATA_DIR / REQ_DOCS))
            docs = merge_requirements(docs_now, _dicts(unredact(files[REQ_DOCS], docs_now)), idmap, {f["id"] for f in folders})
            _write_json(DATA_DIR / REQ_DOCS, docs)
            done["files"].append(REQ_DOCS)
        if REQ_SEEDED in files:
            seeded = _current_json(DATA_DIR / REQ_SEEDED)
            both = {x for x in (seeded or []) + (files[REQ_SEEDED] or []) if isinstance(x, str)}
            _write_json(DATA_DIR / REQ_SEEDED, sorted(both))
            done["files"].append(REQ_SEEDED)
    except Exception as e:     # noqa: BLE001 — остальные разделы восстанавливаем дальше
        errors.append(f"«Данные» (дерево и документы): {e}"[:300])


def _restore_dashboard(path: Path, incoming: dict, mode: str, login: str = '') -> None:
    """Общие виджеты восстанавливаются всем; личные — только если копию загружает их владелец (login).
    Чужие личные виджеты на сервере не трогаются ни в одном режиме."""
    from db import dashboard_store
    from backend.api.dashboard import positioned, is_personal
    if isinstance(incoming, dict) and isinstance(incoming.get('widgets'), list):
        skip = {w.get('id') for w in incoming['widgets'] if isinstance(w, dict) and is_personal(w) and (not login or w.get('owner') != login)}
        incoming = {**incoming, 'widgets': [w for w in incoming['widgets'] if not (isinstance(w, dict) and w.get('id') in skip)],
                    'queues': {k: v for k, v in (incoming.get('queues') or {}).items() if k not in skip}}
    with dashboard_store.LOCK:
        current = (_current_json(path) if mode == 'merge' else _read_json(path)) or {'version': 0, 'widgets': [], 'queues': {}}
        if not isinstance(current, dict) or not isinstance(current.get('widgets'), list):
            if mode == 'merge': raise ValueError('Текущие данные Главной повреждены.')
            current = {'version': 0, 'widgets': [], 'queues': {}}
        if not isinstance(incoming, dict) or not isinstance(incoming.get('widgets'), list) or not isinstance(incoming.get('queues', {}), dict):
            raise ValueError('Некорректные данные Главной в копии.')
        # Validate even colliding incoming widgets; never silently import malformed settings.
        source = positioned(incoming['widgets'], repair=True)
        if len({w['id'] for w in source}) != len(source): raise ValueError('В копии повторяются id виджетов.')
        for queue in incoming.get('queues', {}).values():
            if not isinstance(queue, dict) or not isinstance(queue.get('entries', {}), dict): raise ValueError('Некорректная очередь Главной.')
            for key, entry in queue.get('entries', {}).items():
                if not isinstance(entry, dict) or not isinstance(entry.get('firstSeenAt'), str) or not isinstance(entry.get('issue'), dict) or entry['issue'].get('key') != key or not isinstance(entry['issue'].get('fields', {}), dict):
                    raise ValueError('Некорректная запись очереди Главной.')
        if mode == 'merge':
            result = merge_missing(current, incoming)
            known = {w['id'] for w in current['widgets']}
            by_id = {w['id']: w for w in source}
            existing = [merge_missing(w, by_id.get(w['id'], {}), merge_lists=False) for w in current['widgets']]
            result['widgets'] = positioned([*existing, *(w for w in source if w['id'] not in known)], repair=True)
        else:
            # Перезапись не удаляет чужие личные виджеты и их очереди: их владельцы копию не загружали.
            keep = [w for w in current['widgets'] if is_personal(w) and w.get('owner') != login and w['id'] not in {x['id'] for x in source}]
            queues = {**{w['id']: current.get('queues', {})[w['id']] for w in keep if w['id'] in current.get('queues', {})}, **(incoming.get('queues') or {})}
            result = {**incoming, 'widgets': positioned([*source, *keep]), 'queues': queues}
        # Invalidate old editor versions and in-flight Jira reads.
        result['version'] = int(current.get('version', 0)) + 1
        _write_json(path, result)


def _merge_setting(new, old):
    restored = _unredact_setting(new, old)
    try:
        current, incoming = json.loads(old), json.loads(restored)
        return json.dumps(merge_missing(current, incoming), ensure_ascii=False)
    except (TypeError, ValueError): return old


def _merge_rows(db: Session, table: Table, rows: list[dict], id_maps: dict) -> int:
    """Preserve existing records, map natural-key matches and colliding integer ids across related tables."""
    current = [dict(row) for row in db.execute(table.select()).mappings()]
    primary = [column.name for column in table.primary_key]
    unique = [[column.name for column in constraint.columns] for constraint in table.constraints
              if isinstance(constraint, UniqueConstraint)]
    indexes = [{tuple(row.get(key) for key in group): row for row in current if all(row.get(key) is not None for key in group)} for group in unique]
    by_primary = {tuple(row.get(key) for key in primary): row for row in current} if primary else {}
    mapping = {}
    inserted = 0
    numeric_pk = len(primary) == 1 and isinstance(table.c[primary[0]].type, Integer)
    next_id = max([int(row.get(primary[0]) or 0) for row in [*current, *rows]], default=0) + 1 if numeric_pk else 0
    for source in rows:
        values = _parse_dt(table, source)
        for column in table.columns:
            for foreign in column.foreign_keys:
                target = foreign.column
                values[column.name] = id_maps.get(target.table.name, {}).get((target.name, values.get(column.name)), values.get(column.name))
        natural = [i for i, group in enumerate(unique) if all(values.get(key) is not None for key in group)]
        same = next((row for i in natural if (row := indexes[i].get(tuple(values[key] for key in unique[i]))) is not None), None)
        collision = by_primary.get(tuple(values.get(key) for key in primary)) if primary else None
        if same is None and not natural: same = collision
        if same is None:
            if collision is not None:
                if not numeric_pk: raise ValueError('Конфликт ключей: запись не добавлена.')
                values[primary[0]], next_id = next_id, next_id + 1
            result = db.execute(table.insert().values(**values))
            for key, value in zip(primary, result.inserted_primary_key): values[key] = value
            current.append(values)
            if primary: by_primary[tuple(values.get(key) for key in primary)] = values
            for i in natural: indexes[i][tuple(values[key] for key in unique[i])] = values
            same = values
            inserted += 1
        for key in primary:
            if source.get(key) is not None: mapping[key, source[key]] = same[key]
    _fix_sequence(db, table)
    id_maps[table.name] = mapping
    return inserted


def restore(db: Session, server: dict, sections: Optional[set[str]] = None, mode: Literal['merge', 'replace'] = 'merge',
            login: str = '') -> dict:
    """Restore represented stores: add missing records by default, or explicitly replace them."""
    if mode not in ('merge', 'replace'): raise ValueError('Неизвестный режим восстановления.')
    take = (lambda s: sections is None or s in sections)
    done: dict[str, list[str]] = {"files": [], "tables": [], "settings": [], "assets": []}
    errors: list[str] = []

    files = server.get("files") or {}
    if mode == 'merge' and take(ETALONS) and any(n in files for n in MERGED_FILES):
        _restore_requirements(files, done, errors)

    for name, value in files.items():
        if (mode == 'merge' and name in MERGED_FILES) or not take(FILE_SECTION.get(name, "settings")):
            continue
        if Path(name).name != name or not name.endswith(".json") or name.startswith("."):
            errors.append(f"{name}: недопустимое имя файла")
            continue
        path = DATA_DIR / name
        try:
            if name == 'dashboard.json':
                _restore_dashboard(path, value, mode, login)
            else:
                old = _current_json(path) if mode == 'merge' else _read_json(path)
                restored = unredact(value, old)
                _write_json(path, merge_missing(old, restored) if mode == 'merge' and path.exists() else restored)
            done["files"].append(name)
        except (OSError, TypeError, ValueError) as e:
            errors.append(f"{name}: {e}"[:200])

    tables = _tables()
    incoming_tables = server.get('tables') or {}
    errors.extend(f'{name}: такой таблицы в этой версии нет — пропущена' for name in incoming_tables if name not in tables)
    id_maps, failed = {}, set()
    for name, table in tables.items():
        if name not in incoming_tables: continue
        rows = incoming_tables[name]
        # Каждая таблица — своей транзакцией: сбой одной (например, копия старой версии без нового столбца)
        # откатывает только её, остальное восстанавливается.
        try:
            if name == SETTINGS_TABLE:
                current = {r.key: r.value for r in db.execute(table.select()).fetchall()}
                keys = []
                for r in rows:
                    if not take(setting_section(r.get("key", ""))):
                        continue
                    vals = _parse_dt(table, r)
                    vals.pop('id', None)
                    vals["value"] = _merge_setting(vals.get("value"), current[r['key']]) if mode == 'merge' and r['key'] in current else _unredact_setting(vals.get("value"), current.get(r["key"]))
                    if r["key"] in current:
                        db.execute(table.update().where(table.c.key == r["key"]).values(**vals))
                    else:
                        db.execute(table.insert().values(**vals))
                    current[r['key']] = vals['value']
                    keys.append(r["key"])
                db.commit()
                done["settings"].extend(keys)
                continue
            if not take(TABLE_SECTION.get(name, "settings")):
                continue
            if mode == 'merge':
                if any(fk.column.table.name in failed for col in table.columns for fk in col.foreign_keys):
                    raise ValueError('Не восстановлена связанная таблица; записи пропущены.')
                count = _merge_rows(db, table, rows, id_maps)
            else:
                db.execute(table.delete())
                count = len(rows)
                if rows:
                    db.execute(table.insert(), [_parse_dt(table, r) for r in rows])
                    _fix_sequence(db, table)
            db.commit()
            done["tables"].append(f"{name} ({count})")
        except Exception as e:     # noqa: BLE001
            db.rollback()
            failed.add(name)
            id_maps.pop(name, None)
            errors.append(f"таблица {name}: не удалось восстановить, изменения этой таблицы отменены ({type(e).__name__}).")

    # Рисунки «Данных»: дописываем (имя — хэш содержимого: тот же файл совпадёт сам с собой, чужие не трогаем).
    if server.get("assets") and take(ETALONS):
        import base64
        folder = DATA_DIR / ASSETS_DIR_NAME
        for name, b64 in server["assets"].items():
            if not _ASSET_NAME.match(name):
                errors.append(f"рисунок {name}: недопустимое имя")
                continue
            try:
                folder.mkdir(parents=True, exist_ok=True)
                if mode == 'merge' and (folder / name).exists(): continue
                (folder / name).write_bytes(base64.b64decode(b64, validate=True))
                done["assets"].append(name)
            except (ValueError, OSError) as e:
                errors.append(f"рисунок {name}: {e}"[:200])

    # server["etalons"] из старых копий (эталоны RAG) намеренно не восстанавливается: функция упразднена.
    return {"restored": done, "errors": errors}


# ── API ──────────────────────────────────────────────────────────────────────

@router.get("/api/backup/sections")
def sections() -> dict:
    return {"sections": [{"id": k, "title": v} for k, v in SECTIONS.items()]}


@router.get("/api/backup/export")
def export(scope: str = "all", db: Session = Depends(get_db)) -> dict:
    server = collect(db, scope)
    return {"format": FORMAT, "version": VERSION, "createdAt": datetime.now().isoformat(timespec="seconds"),
            "scope": scope, "scopeTitle": "Все разделы" if scope == "all" else SECTIONS[scope],
            "secrets": "excluded", "server": server, "summary": summary(server)}


class ImportBody(BaseModel):
    backup: dict
    sections: Optional[list[str]] = Field(None, description="Какие разделы восстановить; None — все, что есть в файле")
    mode: Literal['merge', 'replace'] = 'merge'


@router.post("/api/backup/preview")
def preview(body: ImportBody) -> dict:
    """Что есть в файле — по разделам; ничего не меняет."""
    server = _check(body.backup)
    return {"scope": body.backup.get("scope", "all"), "createdAt": body.backup.get("createdAt", ""), "summary": summary(server)}


@router.post("/api/backup/import")
def import_backup(body: ImportBody, db: Session = Depends(get_db), user: dict = Depends(require_user)) -> dict:
    server = _check(body.backup)
    with RESTORE_LOCK:
        snap = _snapshot(db)
        res = restore(db, server, set(body.sections) if body.sections is not None else None, body.mode, user.get('login', ''))
    return {**res, "snapshot": snap, 'mode': body.mode}


def _check(backup: dict) -> dict:
    if backup.get("format") != FORMAT:
        raise HTTPException(422, "Это не резервная копия Shark")
    if int(backup.get("version") or 0) > VERSION:
        raise HTTPException(422, "Копия сделана более новой версией Shark — обновите приложение")
    server = backup.get("server")
    if not isinstance(server, dict):
        raise HTTPException(422, "В копии нет данных сервера")
    for key in ('files', 'tables', 'assets'):
        if key in server and not isinstance(server[key], dict): raise HTTPException(422, f'Некорректный раздел копии: {key}.')
    return server
