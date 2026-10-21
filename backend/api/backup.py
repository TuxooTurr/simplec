"""
Резервная копия данных SimpleTest — выгрузка в один .json и восстановление из него.

Зачем: данные живут внутри папки установки (data/*.json, simpletest.db, db/chroma_data). Переустановка «удалить
папку → поставить заново» стирает их. Перед переустановкой — «Выгрузить всё», после — «Загрузить из файла».

Что входит (раздел = вкладка приложения; выгрузить можно один раздел или все):
  • файлы data/*.json — все, что есть (новые хранилища попадают в выгрузку сами, без правки этого модуля);
  • таблицы БД — настройки (metrics_settings), Метрики ОД, журнал генераций;
  • эталоны RAG (ChromaDB) — тексты, метаданные и векторы (при восстановлении не пересчитываются);
  • браузерные данные (localStorage) кладёт в файл фронт — бэкенд их не видит.
Не входят: кэши, которые собираются заново (индекс Zephyr), JAR-драйверы JDBC, сертификаты и ключи.

Секреты (токены, пароли, ключи API) в файл не попадают: значение заменяется меткой REDACTED. При восстановлении
на месте метки остаётся то, что уже сохранено на этом SimpleTest (пароль подключения с тем же id, токен Jira…);
нечего оставить — поле пустое, его вводят заново.

Восстановление заменяет выбранные разделы целиком (настройки — по ключам, чужие ключи не трогает). Перед заменой
текущие данные сохраняются в data/backups/ (последние 5) — ошибочное восстановление можно откатить.

Эндпоинты:
  GET  /api/backup/sections         — разделы и что в них есть сейчас
  GET  /api/backup/export?scope=…   — выгрузка: all или id раздела (generation, bugs, …)
  POST /api/backup/import           — восстановление: {backup, sections?: [id…]}
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, Table, text
from sqlalchemy.orm import Session

from backend.api.auth import require_superuser
from db.metrics_models import Base
from db.postgres import get_db

# Вся выгрузка и восстановление — только суперюзеру: в файле все данные приложения.
router = APIRouter(dependencies=[Depends(require_superuser)])

FORMAT = "simpletest.backup"
VERSION = 1
REDACTED = "__SIMPLETEST_REDACTED__"
_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = _ROOT / "data"
BACKUPS_DIR = DATA_DIR / "backups"
KEEP_SNAPSHOTS = 5

# Разделы — как вкладки в меню. Файл, таблица или ключ настроек относится к одному разделу; не найденное — в «Общее».
SECTIONS: dict[str, str] = {
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
    "auto_model": "Автотесты",
    "settings": "Настройки и общее",
}

FILE_SECTION: dict[str, str] = {
    "gen_sessions.json": "generation",
    "testdata_connections.json": "test_data", "datagen_config.json": "test_data", "jdbc_drivers.json": "test_data",
    "people.json": "bugs", "jira_views.json": "bugs",
    "zephyr_releases.json": "zephyr",
    "ke_catalog.json": "stands",
    "log_services.json": "logs", "web_connectors.json": "logs",
    "kafka_explorer_connections.json": "kafka",
    "alert_scripts.json": "event_generators", "alert_folders.json": "event_generators", "jobs.json": "event_generators",
    "job_folders.json": "event_generators", "job_history.json": "event_generators", "hub_tiles.json": "event_generators",
    "kernel_audit.json": "event_generators", "teams.json": "event_generators",
    "requirements.json": "etalons",
    "model_bench_scenarios.json": "model_bench", "model_bench_sessions.json": "model_bench",
    "autotest_run_config.json": "auto_model", "autotest_run_history.json": "auto_model",
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
    ("logs_", "logs"), ("revisor_", "auto_model"), ("kafka_", "kafka"), ("tcs_", "event_generators"),
]
SETTINGS_TABLE = "metrics_settings"
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


def _etalons_dump() -> tuple[Optional[dict], str]:
    """Коллекции эталонов: ids, тексты, метаданные, векторы. ChromaDB не поднялась — раздел пропускается с причиной."""
    try:
        from db.vector_store import VectorStore
        vs = VectorStore()
        out = {}
        for col in vs.client.list_collections():
            name = col if isinstance(col, str) else col.name
            c = vs.client.get_collection(name)
            got = c.get(include=["documents", "metadatas", "embeddings"])
            emb = got.get("embeddings")
            out[name] = {"ids": got["ids"], "documents": got.get("documents") or [], "metadatas": got.get("metadatas") or [],
                         "embeddings": [list(map(float, e)) for e in emb] if emb is not None else []}
        return out, ""
    except Exception as e:     # noqa: BLE001 — эталоны необязательны, остальное выгружается
        return None, f"эталоны не выгружены: {e}"[:300]


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
        et, err = _etalons_dump()
        if et is not None:
            out["etalons"] = et
        if err:
            skipped.append(err)
    return {**out, "skipped": skipped}


def summary(server: dict) -> list[dict]:
    """Что лежит в выгрузке по разделам: [{id, title, files, tables, settings, etalons}] — для окна восстановления."""
    acc: dict[str, dict] = {}

    def at(s: str) -> dict:
        return acc.setdefault(s, {"id": s, "title": SECTIONS.get(s, s), "files": [], "tables": [], "settings": 0, "etalons": 0})
    for name in server.get("files", {}):
        at(FILE_SECTION.get(name, "settings"))["files"].append(name)
    for name, rows in server.get("tables", {}).items():
        if name == SETTINGS_TABLE:
            for r in rows:
                at(setting_section(r["key"]))["settings"] += 1
        else:
            at(TABLE_SECTION.get(name, "settings"))["tables"].append(f"{name} ({len(rows)})")
    if server.get("etalons"):
        at(ETALONS)["etalons"] = sum(len(c.get("ids") or []) for c in server["etalons"].values())
    return [acc[s] for s in SECTIONS if s in acc]


# ── Восстановление ───────────────────────────────────────────────────────────

def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".restore.tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(path)


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
    path = BACKUPS_DIR / f"before-restore-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    _write_json(path, {"format": FORMAT, "version": VERSION, "createdAt": datetime.now().isoformat(timespec="seconds"),
                       "scope": "all", "secrets": "included", "server": collect(db, "all", secrets=True)})
    for old in sorted(BACKUPS_DIR.glob("before-restore-*.json"))[:-KEEP_SNAPSHOTS]:
        old.unlink(missing_ok=True)
    return str(path.relative_to(_ROOT))


def restore(db: Session, server: dict, sections: Optional[set[str]] = None) -> dict:
    """Заменить выбранные разделы данными из выгрузки. Возвращает, что восстановлено."""
    take = (lambda s: sections is None or s in sections)
    done: dict[str, list[str]] = {"files": [], "tables": [], "settings": [], "etalons": []}
    errors: list[str] = []

    for name, value in (server.get("files") or {}).items():
        if not take(FILE_SECTION.get(name, "settings")):
            continue
        if Path(name).name != name or not name.endswith(".json") or name.startswith("."):
            errors.append(f"{name}: недопустимое имя файла")
            continue
        path = DATA_DIR / name
        try:
            old = json.loads(path.read_text("utf-8")) if path.exists() else None
        except (OSError, ValueError):
            old = None
        _write_json(path, unredact(value, old))
        done["files"].append(name)

    tables = _tables()
    for name, rows in (server.get("tables") or {}).items():
        table = tables.get(name)
        if table is None:
            errors.append(f"{name}: такой таблицы в этой версии нет — пропущена")
            continue
        if name == SETTINGS_TABLE:
            current = {r.key: r.value for r in db.execute(table.select()).fetchall()}
            for r in rows:
                if not take(setting_section(r.get("key", ""))):
                    continue
                vals = _parse_dt(table, r)
                vals["value"] = _unredact_setting(vals.get("value"), current.get(r["key"]))
                if r["key"] in current:
                    db.execute(table.update().where(table.c.key == r["key"]).values(**vals))
                else:
                    db.execute(table.insert().values(**vals))
                done["settings"].append(r["key"])
            continue
        if not take(TABLE_SECTION.get(name, "settings")):
            continue
        db.execute(table.delete())
        if rows:
            db.execute(table.insert(), [_parse_dt(table, r) for r in rows])
            _fix_sequence(db, table)
        done["tables"].append(f"{name} ({len(rows)})")
    db.commit()

    if server.get("etalons") and take(ETALONS):
        try:
            from db.vector_store import VectorStore
            vs = VectorStore()
            for name, c in server["etalons"].items():
                col = vs.client.get_or_create_collection(name, embedding_function=vs.ef)
                ids = c.get("ids") or []
                if not ids:
                    continue
                docs, metas, embs = c.get("documents") or [], c.get("metadatas") or [], c.get("embeddings") or []
                # Chroma не принимает пустые метаданные — записи с ними и без них пишем отдельными пачками.
                for with_meta in (True, False):
                    idx = [i for i in range(len(ids)) if bool(i < len(metas) and metas[i]) == with_meta]
                    if not idx:
                        continue
                    kw: dict[str, Any] = {"ids": [ids[i] for i in idx]}
                    if docs:
                        kw["documents"] = [docs[i] for i in idx]
                    if with_meta:
                        kw["metadatas"] = [metas[i] for i in idx]
                    if embs:
                        kw["embeddings"] = [embs[i] for i in idx]
                    col.upsert(**kw)
                done["etalons"].append(f"{name} ({len(ids)})")
        except Exception as e:     # noqa: BLE001
            errors.append(f"эталоны не восстановлены: {e}"[:300])
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


@router.post("/api/backup/preview")
def preview(body: ImportBody) -> dict:
    """Что есть в файле — по разделам; ничего не меняет."""
    server = _check(body.backup)
    return {"scope": body.backup.get("scope", "all"), "createdAt": body.backup.get("createdAt", ""), "summary": summary(server)}


@router.post("/api/backup/import")
def import_backup(body: ImportBody, db: Session = Depends(get_db)) -> dict:
    server = _check(body.backup)
    snap = _snapshot(db)
    res = restore(db, server, set(body.sections) if body.sections is not None else None)
    return {**res, "snapshot": snap}


def _check(backup: dict) -> dict:
    if backup.get("format") != FORMAT:
        raise HTTPException(422, "Это не резервная копия SimpleTest")
    if int(backup.get("version") or 0) > VERSION:
        raise HTTPException(422, "Копия сделана более новой версией SimpleTest — обновите приложение")
    server = backup.get("server")
    if not isinstance(server, dict):
        raise HTTPException(422, "В копии нет данных сервера")
    return server
