"""
CRUD эндпоинты для эталонных пар:
  - Тест-кейсы:  /api/etalons    (требование → XML)
  - Автотесты:   /api/autotests  (XML мануальный кейс → Java)
  - Дефекты:     /api/defects    (описание → тело дефекта)
"""
import logging
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from backend.schemas import EtalonAddRequest

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_store():
    from db.vector_store import VectorStore
    return VectorStore()


def _err_detail(e: Exception) -> str:
    """Человекочитаемая причина вместо «Внутренняя ошибка сервера».

    Частый случай: при первом сохранении Chroma качает модель эмбеддингов
    с huggingface.co — в закрытой сети это падает, и без деталей причина неясна.
    """
    msg = str(e) or type(e).__name__
    low = msg.lower()
    if any(k in low for k in ("huggingface", "connection", "getaddrinfo", "max retries", "timed out", "offline", "ssl")):
        return (
            "Не удалось загрузить модель эмбеддингов — при первом сохранении нужен доступ "
            "к huggingface.co. В закрытой сети скопируйте с другой машины папку "
            "~/.cache/huggingface/hub/models--sentence-transformers--paraphrase-multilingual-MiniLM-L12-v2. "
            f"Детали: {msg[:200]}"
        )
    return f"Ошибка векторного хранилища: {msg[:300]}"


# ═══════════════════════════════════════════════════════════════════════════════
# Тест-кейсы
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/api/etalons")
def list_etalons(platform: str = "", feature: str = "", limit: int = 50, offset: int = 0):
    """Список всех эталонных пар с опциональной фильтрацией."""
    store = _get_store()
    try:
        where = {}
        if platform:
            where["platform"] = platform
        if feature:
            where["feature"] = feature

        kwargs = {"limit": limit, "offset": offset}
        if where:
            kwargs["where"] = where

        result = store.pairs.get(**kwargs)

        items = []
        ids = result.get("ids", [])
        docs = result.get("documents", [])
        metas = result.get("metadatas", []) or [{}] * len(ids)

        for i, pair_id in enumerate(ids):
            meta = metas[i] if i < len(metas) else {}
            items.append({
                "id": pair_id,
                "req_text": docs[i] if i < len(docs) else "",
                "tc_text": meta.get("test_case_xml", ""),
                "qa_doc": meta.get("qa_doc", "") or None,
                "platform": meta.get("platform", ""),
                "feature": meta.get("feature", ""),
                "name": meta.get("name", ""),
            })
        return {"items": items, "total": len(items)}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте эталонов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


@router.get("/api/etalons/stats")
def etalon_stats():
    store = _get_store()
    return store.get_stats()


@router.post("/api/etalons")
async def add_etalon(
    req_text: str = Form(""),
    tc_text: str = Form(""),
    qa_doc: str = Form(""),
    platform: str = Form(""),
    feature: str = Form(""),
    name: str = Form(""),
    req_file: Optional[UploadFile] = File(None),
    tc_file: Optional[UploadFile] = File(None),
):
    """Добавить эталонную пару. Принимает текст или файл для каждой части."""
    from agents.file_parser import parse_file

    try:
        if req_file:
            data = await req_file.read()
            req_text = parse_file(data, req_file.filename)

        if tc_file:
            data = await tc_file.read()
            tc_text = parse_file(data, tc_file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not req_text or not tc_text:
        raise HTTPException(status_code=400, detail="req_text и tc_text обязательны")

    pair_id = str(uuid.uuid4())
    store = _get_store()
    try:
        store.add_pair(
            pair_id=pair_id,
            requirement_text=req_text,
            test_case_xml=tc_text,
            qa_doc=qa_doc,
            platform=platform,
            feature=feature,
            name=name,
        )
        return {"id": pair_id, "status": "added"}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте эталонов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


@router.delete("/api/etalons/{pair_id}")
def delete_etalon(pair_id: str):
    store = _get_store()
    try:
        store.pairs.delete(ids=[pair_id])
        return {"status": "deleted", "id": pair_id}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте эталонов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


# ═══════════════════════════════════════════════════════════════════════════════
# Автотесты
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/api/autotests")
def list_autotests(feature: str = "", limit: int = 50, offset: int = 0):
    """Список пар XML → Java."""
    store = _get_store()
    try:
        kwargs: dict = {"limit": limit, "offset": offset}
        if feature:
            kwargs["where"] = {"feature": feature}

        result = store.autotest_pairs.get(**kwargs)

        ids   = result.get("ids", [])
        docs  = result.get("documents", [])
        metas = result.get("metadatas", []) or [{}] * len(ids)

        items = []
        for i, pair_id in enumerate(ids):
            meta = metas[i] if i < len(metas) else {}
            items.append({
                "id":        pair_id,
                "xml_text":  docs[i] if i < len(docs) else "",
                "java_text": meta.get("java_text", ""),
                "feature":   meta.get("feature", ""),
                "name":      meta.get("name", ""),
            })
        return {"items": items, "total": len(items)}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте эталонов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


@router.post("/api/autotests")
async def add_autotest(
    xml_text:  str = Form(""),
    java_text: str = Form(""),
    feature:   str = Form(""),
    name:      str = Form(""),
    xml_file:  Optional[UploadFile] = File(None),
    java_file: Optional[UploadFile] = File(None),
):
    """Добавить пару XML → Java."""
    from agents.file_parser import parse_file

    try:
        if xml_file:
            data = await xml_file.read()
            xml_text = parse_file(data, xml_file.filename)

        if java_file:
            data = await java_file.read()
            java_text = parse_file(data, java_file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not xml_text or not java_text:
        raise HTTPException(status_code=400, detail="xml_text и java_text обязательны")

    pair_id = str(uuid.uuid4())
    store = _get_store()
    try:
        store.add_autotest_pair(
            pair_id=pair_id,
            xml_text=xml_text,
            java_text=java_text,
            feature=feature,
            name=name,
        )
        return {"id": pair_id, "status": "added"}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте эталонов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


@router.delete("/api/autotests/{pair_id}")
def delete_autotest(pair_id: str):
    store = _get_store()
    try:
        store.autotest_pairs.delete(ids=[pair_id])
        return {"status": "deleted", "id": pair_id}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте эталонов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


# ═══════════════════════════════════════════════════════════════════════════════
# Дефекты
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/api/defects")
def list_defects(feature: str = "", limit: int = 50, offset: int = 0):
    """Список пар описание → тело дефекта."""
    store = _get_store()
    try:
        kwargs: dict = {"limit": limit, "offset": offset}
        if feature:
            kwargs["where"] = {"feature": feature}

        result = store.defect_pairs.get(**kwargs)

        ids   = result.get("ids", [])
        docs  = result.get("documents", [])
        metas = result.get("metadatas", []) or [{}] * len(ids)

        items = []
        for i, pair_id in enumerate(ids):
            meta = metas[i] if i < len(metas) else {}
            items.append({
                "id":          pair_id,
                "description": docs[i] if i < len(docs) else "",
                "defect_body": meta.get("defect_body", ""),
                "feature":     meta.get("feature", ""),
                "name":        meta.get("name", ""),
            })
        return {"items": items, "total": len(items)}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте эталонов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


@router.post("/api/defects")
async def add_defect(
    description: str = Form(""),
    defect_body: str = Form(""),
    feature:     str = Form(""),
    name:        str = Form(""),
):
    """Добавить пару описание дефекта → тело дефекта."""
    if not description or not defect_body:
        raise HTTPException(status_code=400, detail="description и defect_body обязательны")

    pair_id = str(uuid.uuid4())
    store = _get_store()
    try:
        store.add_defect_pair(
            pair_id=pair_id,
            description=description,
            defect_body=defect_body,
            feature=feature,
            name=name,
        )
        return {"id": pair_id, "status": "added"}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте эталонов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


@router.delete("/api/defects/{pair_id}")
def delete_defect(pair_id: str):
    store = _get_store()
    try:
        store.defect_pairs.delete(ids=[pair_id])
        return {"status": "deleted", "id": pair_id}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте эталонов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


# ═══════════════════════════════════════════════════════════════════════════════
# Контекстные документы
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/api/context-docs")
def list_context_docs(doc_type: str = "", feature: str = "", limit: int = 50, offset: int = 0):
    store = _get_store()
    try:
        kwargs: dict = {"limit": limit, "offset": offset}
        where_conditions = []
        if doc_type:
            where_conditions.append({"doc_type": doc_type})
        if feature:
            where_conditions.append({"feature": feature})
        if len(where_conditions) == 1:
            kwargs["where"] = where_conditions[0]
        elif len(where_conditions) > 1:
            kwargs["where"] = {"$and": where_conditions}

        result = store.context_docs.get(**kwargs)

        ids = result.get("ids", [])
        docs = result.get("documents", [])
        metas = result.get("metadatas", []) or [{}] * len(ids)

        items = []
        for i, doc_id in enumerate(ids):
            meta = metas[i] if i < len(metas) else {}
            items.append({
                "id": doc_id,
                "content": docs[i] if i < len(docs) else "",
                "name": meta.get("name", ""),
                "doc_type": meta.get("doc_type", "document"),
                "feature": meta.get("feature", ""),
                "filename": meta.get("filename", ""),
            })
        return {"items": items, "total": len(items)}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте контекстных документов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


@router.post("/api/context-docs")
async def add_context_doc(
    content: str = Form(""),
    name: str = Form(""),
    doc_type: str = Form("document"),
    feature: str = Form(""),
    file: Optional[UploadFile] = File(None),
):
    from agents.file_parser import parse_file

    filename = ""
    if file:
        data = await file.read()
        try:
            content = parse_file(data, file.filename)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        filename = file.filename or ""
        if not name:
            name = filename

    if not content:
        raise HTTPException(status_code=400, detail="content обязателен (текст или файл)")

    doc_id = str(uuid.uuid4())
    store = _get_store()
    try:
        store.add_context_doc(
            doc_id=doc_id,
            content=content,
            name=name,
            doc_type=doc_type,
            feature=feature,
            filename=filename,
        )
        return {"id": doc_id, "status": "added"}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте контекстных документов")
        raise HTTPException(status_code=500, detail=_err_detail(e))


@router.delete("/api/context-docs/{doc_id}")
def delete_context_doc(doc_id: str):
    store = _get_store()
    try:
        store.context_docs.delete(ids=[doc_id])
        return {"status": "deleted", "id": doc_id}
    except Exception as e:
        logger.exception("Ошибка в эндпоинте контекстных документов")
        raise HTTPException(status_code=500, detail=_err_detail(e))
