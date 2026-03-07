"""
Эндпоинт форматирования баг-репортов через LLM.
"""
import asyncio
from typing import List
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from backend.schemas import BugFormatResponse

router = APIRouter()


def _format_bug_sync(platform: str, feature: str, description: str, provider: str) -> str:
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)

    feature_hint = f"\nФИЧА / МОДУЛЬ (подсказка): {feature.strip()}" if feature.strip() else ""

    prompt = f"""Ты ведущий QA-аналитик. Проанализируй входные данные и оформи ОДИН или НЕСКОЛЬКО структурированных баг-репортов в формате Jira.

КОМПОНЕНТ (выбран пользователем): {platform}{feature_hint}

ВХОДНЫЕ ДАННЫЕ:
{description}

═══════════════════════════════════════════════════
ИНСТРУКЦИИ
═══════════════════════════════════════════════════
1. Определи, сколько отдельных дефектов содержится во входных данных. Оформи каждый отдельно.
2. Название дефекта строго в формате: `[{platform}][НазваниеМодуля] Краткое описание проблемы`
   - [{platform}] — компонент, всегда берётся из выбранного пользователем.
   - [НазваниеМодуля] — кратко: экран, операция или модуль из контекста (например, [Маркеры инцидента], [Авторизация], [Оплата]). Если пользователь указал фичу — используй её.
   - Описание — конкретное, до 100 символов.
3. Шаги воспроизведения — реалистичные, как их выполнит живой тестировщик.
4. В «Фактический результат» — вставь точные фрагменты из логов / стектрейсов / кодов ошибок, если они присутствуют во входных данных.
5. Раздел «Решение / Хотфикс» добавляй ТОЛЬКО если во входных данных упомянуто конкретное решение.
6. После всех дефектов добавь единый раздел **Дополнительная информация** с общим контекстом (контур, дата, сервис, версия и т.д.), если такие данные есть.
7. Если данных недостаточно для поля — напиши «Требует уточнения».
8. Только Markdown. Никаких вводных слов и пояснений от себя.

═══════════════════════════════════════════════════
ФОРМАТ КАЖДОГО ДЕФЕКТА
═══════════════════════════════════════════════════

---

### Дефект N

**Название дефекта:** `[{platform}][НазваниеМодуля] Краткое описание`

**Описание проблемы:**
Развёрнутое объяснение причины и контекста.

**Шаги воспроизведения:**
1. ...
2. ...
3. Наблюдать результат

**Ожидаемый результат:**
...

**Фактический результат:**
...

**Решение / Хотфикс:** *(только если есть во входных данных)*
...

---"""

    response = llm.chat(
        [Message(role="user", content=prompt)],
        temperature=0.2,
        max_tokens=3000,
    )
    return response.content.strip()


@router.post("/api/bugs/format", response_model=BugFormatResponse)
async def format_bug(
    platform: str = Form(...),
    feature: str = Form(""),
    description: str = Form(...),
    provider: str = Form("gigachat"),
    attachments: List[UploadFile] = File(default=[]),
):
    from agents.file_parser import parse_file

    # Парсим вложения и добавляем их текст к описанию
    attachment_texts = []
    for f in attachments:
        if f and f.filename:
            try:
                data = await f.read()
                text = parse_file(data, f.filename)
                attachment_texts.append(f"[{f.filename}]:\n{text}")
            except Exception as e:
                attachment_texts.append(f"[{f.filename}]: не удалось прочитать — {e}")

    full_description = description
    if attachment_texts:
        full_description += "\n\n─── ВЛОЖЕНИЯ ───\n" + "\n\n".join(attachment_texts)

    try:
        report = await asyncio.to_thread(
            _format_bug_sync,
            platform, feature, full_description, provider
        )
        return {"report": report}
    except Exception as e:
        from agents.llm_client import LLMClient
        is_llm, friendly = LLMClient.classify_error(e)
        raise HTTPException(
            status_code=503 if is_llm else 500,
            detail={"message": friendly, "llm_error": is_llm}
        )
