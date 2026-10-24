"""
Библиотека требований — локальный список (см. db/requirements_store.py).

Используется как переключаемый источник при генерации тест-кейсов
(свободный ввод / выбор из списка) и как контекст при регистрации
дефекта (какие требования затрагивает дефект — чтобы ИИ точнее
описывал его, зная реальные поля БД, методы API и бизнес-правила).

Также по требованию (POST /api/requirements/{id}/generate-doc) можно
переработать исходник в QA-документацию тем же генератором (Layer 1), что
используется при генерации тест-кейсов — исходник и результат хранятся
вместе в одной записи, без ChromaDB/эмбеддингов.

В разделе «Данные» требования — документы в дереве папок (как страницы в Notion): папки вложенные,
документ можно переименовать, перенести, поправить исходник (PATCH).
"""
import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from db.requirements_store import RequirementsStore

router = APIRouter()


class AddRequirementBody(BaseModel):
    name: str = Field(..., min_length=1)
    feature: str = Field(default="")
    text: str = Field(..., min_length=1)
    # Готовая QA-документация — например, из "Ручного тестирования", где Layer 1
    # уже посчитан генерацией кейсов; повторный вызов LLM тут не нужен.
    qa_doc: str = Field(default="")
    qa_doc_truncated: bool = Field(default=False)
    folder_id: str = Field(default="")


@router.get("/api/requirements")
def list_requirements(feature: str = Query(default="")) -> list[dict]:
    return RequirementsStore.list_requirements(feature)


@router.post("/api/requirements")
def add_requirement(body: AddRequirementBody) -> dict:
    if not RequirementsStore.folder_exists(body.folder_id):
        raise HTTPException(status_code=404, detail="Папки уже нет — обновите дерево")
    return RequirementsStore.add_requirement(body.name, body.feature, body.text, body.qa_doc, body.qa_doc_truncated,
                                             body.folder_id)


class FolderBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    parent_id: str = Field(default="")


class FolderPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    parent_id: Optional[str] = None


@router.get("/api/requirements/folders")
def list_folders() -> list[dict]:
    return RequirementsStore.list_folders()


@router.post("/api/requirements/folders")
def add_folder(body: FolderBody) -> dict:
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Название папки пустое")
    try:
        return RequirementsStore.add_folder(body.name, body.parent_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Родительской папки уже нет — обновите дерево")


@router.patch("/api/requirements/folders/{folder_id}")
def update_folder(folder_id: str, body: FolderPatch) -> dict:
    if body.name is not None and not body.name.strip():
        raise HTTPException(status_code=422, detail="Название папки пустое")
    try:
        item = RequirementsStore.update_folder(folder_id, body.name, body.parent_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Папки, куда переносите, уже нет — обновите дерево")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if item is None:
        raise HTTPException(status_code=404, detail="Папка не найдена")
    return item


@router.delete("/api/requirements/folders/{folder_id}")
def delete_folder(folder_id: str) -> dict:
    moved = RequirementsStore.delete_folder(folder_id)
    if moved is None:
        raise HTTPException(status_code=404, detail="Папка не найдена")
    return {"status": "deleted", "moved": moved}


class RequirementPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    feature: Optional[str] = None
    focus: Optional[str] = None
    text: Optional[str] = Field(default=None, min_length=1)
    folder_id: Optional[str] = None


@router.patch("/api/requirements/{req_id}")
def update_requirement(req_id: str, body: RequirementPatch) -> dict:
    """Заголовок, фича, исходник, папка. Правка исходника не трогает QA-документ: его пересобирают кнопкой."""
    fields = body.model_dump(exclude_none=True)
    if "name" in fields:
        fields["name"] = fields["name"].strip()
        if not fields["name"]:
            raise HTTPException(status_code=422, detail="Заголовок пустой")
    for k in ("feature", "focus"):
        if k in fields:
            fields[k] = fields[k].strip()
    if "folder_id" in fields and not RequirementsStore.folder_exists(fields["folder_id"]):
        raise HTTPException(status_code=404, detail="Папки уже нет — обновите дерево")
    if not fields:
        raise HTTPException(status_code=422, detail="Нечего менять")
    item = RequirementsStore.update_requirement(req_id, **fields)
    if not item:
        raise HTTPException(status_code=404, detail="Требование не найдено")
    return item


@router.delete("/api/requirements/{req_id}")
def delete_requirement(req_id: str) -> dict:
    if not RequirementsStore.delete_requirement(req_id):
        raise HTTPException(status_code=404, detail="Требование не найдено")
    return {"status": "deleted"}


class GenerateDocBody(BaseModel):
    provider: str = Field(..., min_length=1)


@router.post("/api/requirements/{req_id}/generate-doc")
async def generate_requirement_doc(req_id: str, body: GenerateDocBody) -> dict:
    item = RequirementsStore.get_requirement(req_id)
    if not item:
        raise HTTPException(status_code=404, detail="Требование не найдено")

    from agents.llm_client import LLMClient
    from agents.layered_generator import LayeredGenerator

    try:
        llm = LLMClient(provider=body.provider)
        gen = LayeredGenerator(llm)
        qa_doc, truncated = await asyncio.to_thread(
            gen.generate_qa_doc, item["text"], item.get("feature", ""), "", True, item.get("name", ""), item.get("focus", "")
        )
    except Exception as e:
        _, friendly = LLMClient.classify_error(e)
        raise HTTPException(status_code=400, detail=f"Не удалось сгенерировать документацию: {friendly}")

    updated = RequirementsStore.update_requirement(req_id, qa_doc=qa_doc, qa_doc_truncated=truncated)
    if not updated:
        raise HTTPException(status_code=404, detail="Требование исчезло во время генерации — начните заново")
    return updated


# ── Confluence: требования со страниц ────────────────────────────────────────
#
# Страница (ссылка, id или «/display/ПРОСТРАНСТВО/Заголовок») → Markdown (agents/confluence_md.py). Документ помнит
# свои страницы (sources: id, заголовок, ссылка, версия Confluence) — по ним его можно обновить новой версией.
# В одном документе может быть несколько СТ: каждая — разделом «## Заголовок СТ» со ссылкой на страницу.

MAX_PAGES = 60


def _cf():
    from backend.api import confluence
    from db.postgres import SessionLocal
    db = SessionLocal()
    try:
        return confluence, confluence._load_cfg(db)
    finally:
        db.close()


def _page_meta(cfg: dict, data: dict) -> dict:
    from agents.confluence_md import storage_to_markdown
    space = ((data.get("space") or {}).get("key")) or ""
    webui = ((data.get("_links") or {}).get("webui")) or f"/pages/viewpage.action?pageId={data.get('id')}"
    body = (((data.get("body") or {}).get("storage") or {}).get("value")) or ""
    return {"id": str(data.get("id")), "title": data.get("title") or "", "space": space,
            "url": cfg["base_url"] + webui, "version": ((data.get("version") or {}).get("number")) or 0,
            "markdown": storage_to_markdown(body, cfg["base_url"], space)}


_EXPAND = "body.storage,version,space"


def fetch_page(ref: str) -> dict:
    """Страница Confluence по ссылке, id или /display/ПРОСТРАНСТВО/Заголовок → {id, title, url, version, markdown}."""
    from urllib.parse import unquote_plus
    import re as _re
    confluence, cfg = _cf()
    kind, val = confluence.page_ref(ref)
    if kind == "id":
        data = confluence._request(cfg, "GET", f"/rest/api/content/{val}", params={"expand": _EXPAND})
    else:
        m = _re.search(r"/display/([^/]+)/([^?#]+)", ref)
        space, title = (unquote_plus(m.group(1)), unquote_plus(m.group(2))) if m else (cfg.get("space") or "", ref.strip())
        params = {"title": title, "expand": _EXPAND, "limit": 2}
        if space:
            params["spaceKey"] = space
        found = (confluence._request(cfg, "GET", "/rest/api/content", params=params).get("results") or [])
        if not found:
            raise HTTPException(404, f"Страница «{title}» не найдена" + (f" в пространстве {space}" if space else ""))
        data = found[0]
    return _page_meta(cfg, data)


def fetch_tree(ref: str, children: bool) -> list[dict]:
    """Страница и (если children) все дочерние до 3 уровней, не больше MAX_PAGES. У каждой — parent и depth."""
    root = fetch_page(ref)
    root.update(parent="", depth=0)
    out = [root]
    if not children:
        return out
    confluence, cfg = _cf()
    queue = [root]
    while queue and len(out) < MAX_PAGES:
        cur = queue.pop(0)
        if cur["depth"] >= 3:
            continue
        kids = confluence._request(cfg, "GET", f"/rest/api/content/{cur['id']}/child/page",
                                   params={"expand": _EXPAND, "limit": 100}).get("results") or []
        for k in kids[: MAX_PAGES - len(out)]:
            meta = _page_meta(cfg, k)
            meta.update(parent=cur["id"], depth=cur["depth"] + 1)
            out.append(meta)
            queue.append(meta)
    return out


def _demote(md: str) -> str:
    """СТ внутри документа — разделом «##», поэтому её заголовки опускаются так, чтобы самый крупный стал «###»."""
    import re as _re
    levels = [len(m.group(1)) for m in _re.finditer(r"(?m)^(#{1,6}) ", md)]
    shift = max(0, 3 - min(levels)) if levels else 0
    return _re.sub(r"(?m)^(#{1,6}) ", lambda m: "#" * min(6, len(m.group(1)) + shift) + " ", md) if shift else md


def _src_line(p: dict) -> str:
    return f"> Источник: [{p['title']}]({p['url']}) · версия Confluence {p['version']}"


def section_for(p: dict) -> str:
    """Раздел документа для одной СТ: заголовок, ссылка на страницу, содержимое."""
    return f"## {p['title']}\n\n{_src_line(p)}\n\n{_demote(p['markdown'])}".strip()


def compose(pages: list[dict]) -> str:
    """Исходник документа из страниц: одна — как есть со ссылкой, несколько — разделами по СТ."""
    if len(pages) == 1:
        return f"{_src_line(pages[0])}\n\n{pages[0]['markdown']}".strip()
    return "\n\n".join(section_for(p) for p in pages)


def _meta(p: dict) -> dict:
    return {k: p[k] for k in ("id", "title", "url", "version")}


class ConfluenceRef(BaseModel):
    ref: str = Field(..., min_length=1)
    children: bool = False


@router.post("/api/requirements/confluence/preview")
async def confluence_preview(body: ConfluenceRef) -> dict:
    """Что придёт из Confluence (ничего не сохраняет): страницы с Markdown."""
    pages = await asyncio.to_thread(fetch_tree, body.ref, body.children)
    return {"pages": pages}


class ConfluenceImport(ConfluenceRef):
    folder_id: str = ""
    focus: str = ""


@router.post("/api/requirements/confluence/import")
async def confluence_import(body: ConfluenceImport) -> dict:
    """
    Страница → документ в выбранной папке. С дочерними — дерево как в Confluence: страница, у которой есть дочерние,
    становится папкой с её названием (внутри — документ самой страницы и дочерние).
    """
    if not RequirementsStore.folder_exists(body.folder_id):
        raise HTTPException(404, "Папки уже нет — обновите дерево")
    pages = await asyncio.to_thread(fetch_tree, body.ref, body.children)
    parents = {p["parent"] for p in pages if p["parent"]}
    folder_of: dict[str, str] = {}
    created: list[dict] = []
    for p in pages:
        where = folder_of.get(p["parent"], body.folder_id) if p["parent"] else body.folder_id
        if p["id"] in parents:
            folder_of[p["id"]] = RequirementsStore.add_folder(p["title"][:200] or "Без названия", where)["id"]
            where = folder_of[p["id"]]
        created.append(RequirementsStore.add_requirement(
            p["title"] or "Без названия", "", compose([p]) or "(страница пустая)", folder_id=where,
            sources=[_meta(p)], focus=body.focus if p is pages[0] else ""))
    return {"created": created, "folders": len(folder_of)}


class AddSourceBody(BaseModel):
    ref: str = Field(..., min_length=1)
    as_version: bool = False
    note: str = ""


@router.post("/api/requirements/{req_id}/sources")
async def add_source(req_id: str, body: AddSourceBody) -> dict:
    """Ещё одна СТ в документ — разделом в конец исходника. as_version — новой версией документа."""
    item = RequirementsStore.get_requirement(req_id)
    if not item:
        raise HTTPException(404, "Требование не найдено")
    p = await asyncio.to_thread(fetch_page, body.ref)
    sources = list(item.get("sources") or [])
    if any(s.get("id") == p["id"] for s in sources):
        raise HTTPException(409, f"Страница «{p['title']}» уже есть в документе — обновите её кнопкой «Обновить из Confluence»")
    text = item.get("text", "")
    if len(sources) == 1 and text.startswith("> Источник:"):
        # Первая СТ была без своего раздела — оформляем её разделом, как остальные.
        first, rest = text.split("\n\n", 1) if "\n\n" in text else (text, "")
        text = f"## {sources[0].get('title', 'СТ')}\n\n{first}\n\n{_demote(rest)}".strip()
    text = (text.rstrip() + "\n\n" + section_for(p)).strip()
    sources.append(_meta(p))
    if body.as_version:
        return RequirementsStore.new_version(req_id, text, body.note or f"Добавлена СТ «{p['title']}»", sources)
    return RequirementsStore.update_requirement(req_id, text=text, sources=sources)


@router.post("/api/requirements/{req_id}/sync")
async def sync_sources(req_id: str) -> dict:
    """
    Перечитать страницы документа. Если в Confluence что-то изменилось — исходник собирается заново из страниц
    новой версией документа (с пометкой, какие страницы и с какой версии на какую). Иначе — {changed: false}.
    """
    item = RequirementsStore.get_requirement(req_id)
    if not item:
        raise HTTPException(404, "Требование не найдено")
    sources = item.get("sources") or []
    if not sources:
        raise HTTPException(422, "Документ создан не из Confluence — обновлять нечего")
    pages = await asyncio.to_thread(lambda: [fetch_page(s["id"]) for s in sources])
    old = {s["id"]: s for s in sources}
    moved = [p for p in pages if p["version"] != old.get(p["id"], {}).get("version")]
    if not moved:
        return {"changed": False, "item": item}
    note = "Обновлено из Confluence: " + ", ".join(f"«{p['title']}» v{old[p['id']].get('version')} → v{p['version']}" for p in moved)
    return {"changed": True, "item": RequirementsStore.new_version(req_id, compose(pages), note, [_meta(p) for p in pages])}


class NewVersionBody(BaseModel):
    text: str = Field(..., min_length=1)
    note: str = ""


@router.post("/api/requirements/{req_id}/versions")
def new_version(req_id: str, body: NewVersionBody) -> dict:
    """Новая версия вручную: доработка фичи — новый исходник, прежний вместе с его QA-документом уходит в историю."""
    item = RequirementsStore.new_version(req_id, body.text, body.note)
    if not item:
        raise HTTPException(404, "Требование не найдено")
    return item


def _version(item: dict, n: int) -> dict:
    if n == item.get("version", 1):
        return {"text": item.get("text", ""), "qa_doc": item.get("qa_doc", "")}
    for v in item.get("versions") or []:
        if v.get("n") == n:
            return v
    raise HTTPException(404, f"Версии {n} нет")


@router.get("/api/requirements/{req_id}/diff")
def version_diff(req_id: str, a: int = Query(...), b: int = Query(...), field: str = Query("auto")) -> dict:
    """
    Что изменилось с версии a до версии b. field: qa_doc / text / auto (QA-документ, если он есть у обеих версий,
    иначе исходник). Пункты — с разделом документа, где изменение.
    """
    from agents.md_diff import diff
    item = RequirementsStore.get_requirement(req_id)
    if not item:
        raise HTTPException(404, "Требование не найдено")
    va, vb = _version(item, a), _version(item, b)
    if field == "auto":
        field = "qa_doc" if va.get("qa_doc") and vb.get("qa_doc") else "text"
    if field not in ("qa_doc", "text"):
        raise HTTPException(422, "field: qa_doc, text или auto")
    return {"field": field, **diff(va.get(field, ""), vb.get(field, ""))}
