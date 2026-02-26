"""
Эндпоинт форматирования баг-репортов через LLM.
"""
import asyncio
from fastapi import APIRouter, HTTPException
from backend.schemas import BugFormatRequest, BugFormatResponse

router = APIRouter()


def _format_bug_sync(platform: str, feature: str, description: str, provider: str) -> str:
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)
    prompt = (
        "Ты QA-аналитик. Отформатируй баг-репорт по стандарту Jira.\n\n"
        "ПЛАТФОРМА: " + platform + "\n"
        "ФИЧА: " + feature + "\n"
        "ОПИСАНИЕ: " + description + "\n\n"
        "Напиши структурированный баг-репорт:\n\n"
        "**Краткое описание:** (1 строка)\n\n"
        "**Шаги воспроизведения:**\n"
        "1. ...\n"
        "2. ...\n\n"
        "**Ожидаемый результат:**\n"
        "...\n\n"
        "**Фактический результат:**\n"
        "...\n\n"
        "**Окружение:** " + platform + "\n\n"
        "**Приоритет:** (Critical/High/Medium/Low)\n\n"
        "**Серьёзность:** (Blocker/Critical/Major/Minor/Trivial)\n\n"
        "Только Markdown. Без лишних пояснений."
    )
    response = llm.chat([Message(role="user", content=prompt)],
                        temperature=0.3, max_tokens=1500)
    return response.content.strip()


@router.post("/api/bugs/format", response_model=BugFormatResponse)
async def format_bug(req: BugFormatRequest):
    try:
        report = await asyncio.to_thread(
            _format_bug_sync,
            req.platform, req.feature, req.description, req.provider
        )
        return {"report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
