"""
Хранилище требований — простой локальный список (без ChromaDB/эмбеддингов).

Раньше "эталоны" держали требования только в связке с готовым результатом
(требование → тест-кейс/автотест/дефект) в векторном хранилище — чтобы
подставить требование как контекст в другом месте (например, при регистрации
дефекта), надо было тянуть чужой пример целиком через RAG. Здесь — отдельная,
самостоятельная библиотека требований: имя, фича, текст. Ничего не эмбеддится,
поиск похожести не нужен — пользователь сам выбирает нужное требование из
списка (с фильтром по фиче) или вводит текст свободно.

Файл: data/requirements.json — локально на той машине/сервере, где запущен
бэкенд (не в облаке, без внешних зависимостей вроде huggingface.co).

Дерево папок раздела «Данные» — data/requirement_folders.json: папка {id, name, parent_id}, у требования —
folder_id ("" — в корне). Папки только группируют: где бы ни лежало требование, его видят выбор требований
в генерации и в дефектах.

Базовое дерево (блок → раздел → фича новой тестовой модели) — db/requirement_folders_default.json, пути
«/Блок/Раздел/Фича» (лежит в репозитории). Как справочник КЭ: при чтении недостающие папки дописываются один раз,
одноимённые на своём месте переиспользуются, удалённая руками не вернётся — уже предложенные пути помним
в requirement_folders_seeded.json рядом с файлом папок.
"""

import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent
_FILE = _ROOT / "data" / "requirements.json"
_FOLDERS = _ROOT / "data" / "requirement_folders.json"
_FOLDERS_DEFAULT = Path(__file__).resolve().parent / "requirement_folders_default.json"
_MAX_ITEMS = 500


class RequirementsStore:

    @staticmethod
    def _load() -> list[dict]:
        if not _FILE.exists():
            return []
        try:
            with open(_FILE, encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            backup = _FILE.with_suffix(f".json.corrupted-{int(datetime.now().timestamp())}")
            try:
                shutil.move(str(_FILE), str(backup))
                logger.warning("requirements.json битый, перемещён в %s", backup)
            except OSError:
                logger.warning("requirements.json битый и не удалось сохранить копию")
            return []

    @staticmethod
    def _save(items: list[dict]) -> None:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = _FILE.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, _FILE)

    @classmethod
    def list_requirements(cls, feature: str = "") -> list[dict]:
        items = cls._load()
        if feature:
            f = feature.strip().lower()
            items = [i for i in items if f in str(i.get("feature", "")).lower()]
        return sorted(items, key=lambda i: i.get("created_at", ""), reverse=True)

    @classmethod
    def get_requirement(cls, req_id: str) -> Optional[dict]:
        for i in cls._load():
            if i.get("id") == req_id:
                return i
        return None

    @classmethod
    def add_requirement(cls, name: str, feature: str, text: str,
                         qa_doc: str = "", qa_doc_truncated: bool = False, folder_id: str = "",
                         sources: Optional[list] = None, focus: str = "") -> dict:
        now = datetime.now(timezone.utc).isoformat()
        item = {
            "id": uuid.uuid4().hex[:12],
            "name": name.strip(),
            "feature": feature.strip(),
            "text": text,
            # Переработанный документ (Layer 1 QA-документации) — либо генерируется
            # отдельно по требованию (POST /api/requirements/{id}/generate-doc), либо
            # приходит уже готовым (например, из "Ручного тестирования" — там QA-doc
            # уже посчитан генерацией кейсов, повторный вызов LLM не нужен). Хранится
            # вместе с исходником в этой же записи: исходник и результат всегда рядом.
            "qa_doc": qa_doc,
            "qa_doc_truncated": qa_doc_truncated,
            "folder_id": folder_id,
            # Что именно нужно из исходника (если в нём несколько СТ) — подсказка генератору документа QA.
            "focus": focus.strip(),
            # Страницы Confluence, из которых собран исходник: [{id, title, url, version}] — для обновления.
            "sources": list(sources or []),
            # Версии: текущая — в полях записи (version, version_at, version_note), прошлые — в versions.
            "version": 1,
            "version_at": now,
            "version_note": "",
            "versions": [],
            "created_at": now,
            "updated_at": now,
        }
        items = cls._load()
        items.insert(0, item)
        items = items[:_MAX_ITEMS]
        cls._save(items)
        return item

    @classmethod
    def update_requirement(cls, req_id: str, **fields) -> Optional[dict]:
        items = cls._load()
        for i in items:
            if i.get("id") == req_id:
                i.update(fields)
                i["updated_at"] = datetime.now(timezone.utc).isoformat()
                cls._save(items)
                return i
        return None

    @classmethod
    def new_version(cls, req_id: str, text: str, note: str = "", sources: Optional[list] = None) -> Optional[dict]:
        """
        Новая версия документа: текущие исходник и QA-документ уходят в историю (versions), исходник — новый,
        QA-документ — пустой (собирается заново по новой версии). Номер версии растёт.
        """
        items = cls._load()
        for i in items:
            if i.get("id") == req_id:
                now = datetime.now(timezone.utc).isoformat()
                i.setdefault("versions", []).append({
                    "n": i.get("version", 1), "at": i.get("version_at") or i.get("created_at", now),
                    "note": i.get("version_note", ""), "text": i.get("text", ""), "qa_doc": i.get("qa_doc", ""),
                    "qa_doc_truncated": i.get("qa_doc_truncated", False), "sources": i.get("sources", []),
                })
                i.update(text=text, qa_doc="", qa_doc_truncated=False, version=i.get("version", 1) + 1,
                         version_at=now, version_note=note.strip(), updated_at=now)
                if sources is not None:
                    i["sources"] = sources
                cls._save(items)
                return i
        return None

    @classmethod
    def delete_requirement(cls, req_id: str) -> bool:
        items = cls._load()
        before = len(items)
        items = [i for i in items if i.get("id") != req_id]
        if len(items) == before:
            return False
        cls._save(items)
        return True

    # ── Папки ────────────────────────────────────────────────────────────────

    @classmethod
    def _load_folders(cls) -> list[dict]:
        if not _FOLDERS.exists():
            return cls._seed_folders([])
        try:
            with open(_FOLDERS, encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError:
            logger.warning("requirement_folders.json битый — папки не прочитаны")
            return []
        # Непонятный файл не трогаем: базовое дерево поверх него затёрло бы чужие папки.
        return cls._seed_folders(data) if isinstance(data, list) else []

    @classmethod
    def _seed_folders(cls, items: list[dict]) -> list[dict]:
        """Дописать базовое дерево: пути, которые ещё не предлагали, — недостающими папками."""
        try:
            defaults = [p for p in json.loads(_FOLDERS_DEFAULT.read_text("utf-8")) if isinstance(p, str)]
        except (OSError, ValueError):
            return items
        # Отметка — рядом с файлом папок: где папки, там и память о предложенном (тесты с временными файлами её не трогают).
        seeded_file = _FOLDERS.with_name("requirement_folders_seeded.json")
        try:
            seeded = set(json.loads(seeded_file.read_text("utf-8")))
        except (OSError, ValueError):
            seeded = set()
        fresh = [p for p in defaults if p not in seeded]
        if not fresh:
            return items
        now = datetime.now(timezone.utc).isoformat()
        for path in fresh:
            parent = ""
            for name in [x.strip() for x in path.split("/") if x.strip()]:
                f = next((x for x in items if x.get("parent_id", "") == parent
                          and str(x.get("name", "")).strip().lower() == name.lower()), None)
                if f is None:
                    f = {"id": uuid.uuid4().hex[:12], "name": name, "parent_id": parent, "created_at": now}
                    items.append(f)
                parent = f["id"]
        cls._save_folders(items)
        tmp_path = seeded_file.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(sorted(seeded | set(fresh)), fh, ensure_ascii=False, indent=2)
        os.replace(tmp_path, seeded_file)
        return items

    @staticmethod
    def _save_folders(items: list[dict]) -> None:
        _FOLDERS.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = _FOLDERS.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, _FOLDERS)

    @classmethod
    def list_folders(cls) -> list[dict]:
        return sorted(cls._load_folders(), key=lambda f: str(f.get("name", "")).lower())

    @classmethod
    def folder_exists(cls, folder_id: str) -> bool:
        return not folder_id or any(f.get("id") == folder_id for f in cls._load_folders())

    @classmethod
    def add_folder(cls, name: str, parent_id: str = "") -> dict:
        if not cls.folder_exists(parent_id):
            raise KeyError(parent_id)
        item = {"id": uuid.uuid4().hex[:12], "name": name.strip(), "parent_id": parent_id,
                "created_at": datetime.now(timezone.utc).isoformat()}
        items = cls._load_folders()
        items.append(item)
        cls._save_folders(items)
        return item

    @staticmethod
    def _subtree(items: list[dict], root: str) -> set[str]:
        """Папка и все вложенные в неё на любой глубине."""
        out, todo = {root}, [root]
        while todo:
            cur = todo.pop()
            for f in items:
                if f.get("parent_id") == cur and f["id"] not in out:
                    out.add(f["id"])
                    todo.append(f["id"])
        return out

    @classmethod
    def update_folder(cls, folder_id: str, name: Optional[str] = None, parent_id: Optional[str] = None) -> Optional[dict]:
        """Переименовать или перенести. В себя или во вложенную папку перенести нельзя — ValueError."""
        items = cls._load_folders()
        cur = next((f for f in items if f.get("id") == folder_id), None)
        if cur is None:
            return None
        if parent_id is not None:
            if parent_id and not any(f.get("id") == parent_id for f in items):
                raise KeyError(parent_id)
            if parent_id in cls._subtree(items, folder_id):
                raise ValueError("Папку нельзя перенести в саму себя или во вложенную")
            cur["parent_id"] = parent_id
        if name is not None:
            cur["name"] = name.strip()
        cls._save_folders(items)
        return cur

    @classmethod
    def delete_folder(cls, folder_id: str) -> Optional[int]:
        """Удалить папку со вложенными. Требования из них не удаляются — переходят в папку уровнем выше.
        Сколько требований перенесено; папки нет — None."""
        items = cls._load_folders()
        cur = next((f for f in items if f.get("id") == folder_id), None)
        if cur is None:
            return None
        gone = cls._subtree(items, folder_id)
        cls._save_folders([f for f in items if f["id"] not in gone])
        reqs = cls._load()
        moved = 0
        for r in reqs:
            if r.get("folder_id") in gone:
                r["folder_id"] = cur.get("parent_id", "")
                moved += 1
        if moved:
            cls._save(reqs)
        return moved
