"""
Генерация Java (JUnit 5 + Selenide) по ручным тест-кейсам через LLM.
"""
import asyncio
from fastapi import APIRouter, Form, HTTPException

router = APIRouter()

_JAVA_PROMPT = """\
Ты ведущий QA-автоматизатор. Преобразуй ручные тест-кейсы в Java-класс для автоматизированного тестирования.

Требования к коду:
- Фреймворк: JUnit 5 + Selenide
- Один публичный класс на входные кейсы (имя по фиче или «GeneratedTests»)
- Каждый тест-кейс → отдельный метод с аннотацией @Test
- Шаги → методы Selenide: $(selector), .click(), .setValue(), .shouldBe(Condition.visible) и т.п.
- @DisplayName на русском — точный заголовок кейса
- Добавь @ExtendWith(SelenideExtension.class) на класс
- Используй open() для перехода на страницу, if нет URL в кейсе — open("/") как заглушку
- Только валидный Java-код, без объяснений и markdown-блоков.

ВХОДНЫЕ ТЕСТ-КЕЙСЫ:
{cases}"""


def _generate_sync(cases: str, provider: str) -> str:
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)
    resp = llm.chat(
        [Message(role="user", content=_JAVA_PROMPT.format(cases=cases))],
        temperature=0.2,
        max_tokens=4000,
    )
    return resp.content.strip()


@router.post("/api/autotests/generate")
async def generate_autotest(
    cases:    str = Form(...),
    feature:  str = Form(""),
    provider: str = Form("gigachat"),
):
    """Принимает ручные тест-кейсы и возвращает Java-класс (JUnit5 + Selenide)."""
    try:
        code = await asyncio.to_thread(_generate_sync, cases, provider)
        return {"code": code}
    except Exception as e:
        from agents.llm_client import LLMClient
        is_llm, msg = LLMClient.classify_error(e)
        raise HTTPException(
            status_code=503 if is_llm else 500,
            detail={"message": msg, "llm_error": is_llm},
        )
