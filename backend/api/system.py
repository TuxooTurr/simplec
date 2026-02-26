"""
Системные эндпоинты: healthz, providers, stats.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/healthz")
def healthz():
    return {"status": "ok"}


@router.get("/api/system/providers")
def get_providers():
    from agents.llm_client import LLMClient
    providers_raw = LLMClient.get_available_providers()
    result = []
    for p in providers_raw:
        hc = LLMClient.health_check(p["id"])
        result.append({
            "id": p["id"],
            "name": p["name"],
            "status": hc["status"],
            "message": hc["message"],
        })
    return result


@router.get("/api/system/stats")
def get_stats():
    try:
        from db.feedback_store import FeedbackStore
        store = FeedbackStore()
        return store.get_stats()
    except Exception:
        return {"total": 0, "positive": 0, "negative": 0}
