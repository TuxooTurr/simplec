"""
Эндпоинт форматирования баг-репортов через LLM.

Ответ LLM имеет строгую структуру (название / описание с подразделами / приоритет)
и парсится на части для автоподстановки при регистрации дефекта в Jira:
  title       → Название дефекта (summary)
  description → Описание (целиком, со всеми подразделами)
  priority    → Приоритет
"""
import asyncio
import re
from typing import List
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from backend.schemas import BugFormatResponse

router = APIRouter()

_PRIORITIES = ("Критический", "Высокий", "Средний", "Низкий")


def _format_bug_sync(platform: str, feature: str, description: str, provider: str) -> str:
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)

    feature_hint = f"\nФИЧА / МОДУЛЬ (подсказка): {feature.strip()}" if feature.strip() else ""

    prompt = f"""Ты — опытный QA-инженер. Ты превращаешь краткие, неформальные описания проблем (часто с ошибками, без структуры, с фрагментами JSON, логов, скринов) в чёткий структурированный дефект для Jira.

КОМПОНЕНТ/СЛОЙ (выбран пользователем, не меняй): {platform}{feature_hint}

ВХОДНЫЕ ДАННЫЕ (могут быть неполными, с ошибками; вложения приложены ниже текстом):
{description}

═══════════════════════════════════════════════════
ПРИНЦИПЫ РАБОТЫ
═══════════════════════════════════════════════════
1. Оформи ОДИН дефект по шаблону ниже. Если во входных данных несколько проблем — оформи главную, остальные перечисли в «Гипотезы» с пометкой «возможно, отдельный дефект».
2. Восстанавливай логику проблемы, даже если описание неполное или с ошибками. НЕ ВЫДУМЫВАЙ конкретные данные (ID, точные тексты ошибок, версии).
3. ВЛОЖЕНИЯ ОБЯЗАТЕЛЬНО ИЗУЧИ ВСЕ:
   - Изображения/скриншоты приходят как распознанный с картинки текст (OCR, блок «[имя_файла]») — по этому содержимому опиши, в чём заключается дефект на скрине, и используй это в «Описание дефекта» и «Фактический результат».
   - Логи, JSON, ответы API, выгрузки БД — процитируй КЛЮЧЕВЫЕ фрагменты (ошибка, стектрейс, код ответа) в «Фактический результат» внутри code-блоков ``` как есть, без пересказа.
4. Название строго: `[{platform}][НазваниеМодуля] Краткая суть` (до 100 символов). [НазваниеМодуля] — экран/операция/модуль из контекста; если пользователь указал фичу — используй её.
5. Шаги воспроизведения — реалистичные, как их выполнит живой тестировщик.
6. «Гипотезы» — что вероятно повлияло/причина (на основе входных данных: релиз, конфиг, интеграция, данные). Не выдумывай — помечай степень уверенности.
7. Отвечай на языке входных данных. Только Markdown. Никаких вводных слов и пояснений от себя. Структуру и порядок разделов не меняй.
8. САМАЯ ПОСЛЕДНЯЯ строка ответа — ВСЕГДА отдельная строка ровно вида «Приоритет: X», где X — одно слово из списка: Критический, Высокий, Средний, Низкий. Без этой строки ответ считается неполным. Выбирай по влиянию: Критический — ключевой функционал недоступен, обхода нет; Высокий — важный функционал заблокирован; Средний — есть обходной путь; Низкий — косметика.

═══════════════════════════════════════════════════
СТРОГИЙ ШАБЛОН ОТВЕТА (ровно эта структура)
═══════════════════════════════════════════════════

# [{platform}][НазваниеМодуля] Краткая суть дефекта

## Окружение
- Среда: ИФТ *(если пользователь не указал иное)*
- URL/стенд, роль/учётка, версия/сборка — только если известно.

## Описание дефекта
Развёрнутая суть проблемы: что и где происходит, при каких условиях. Если дефект виден на приложенном скриншоте — опиши, что именно на нём не так.

## Предусловия
1. ...

## Шаги воспроизведения
1. ...
2. ...
3. Наблюдать результат

## Фактический результат
Что происходит сейчас vs что ожидалось. Сюда — точные фрагменты из вложений (ошибки, логи, JSON, ответы БД) в code-блоках:
```
фрагмент лога/JSON как есть
```

## Гипотезы
- Что возможно повлияло (причина, степень уверенности).

Приоритет: <одно слово: Критический / Высокий / Средний / Низкий>"""

    # Обрыв по лимиту токенов до строки "Приоритет: X" (последней в шаблоне) означал
    # бы, что _parse_report() не находит приоритет — chat_continued сам догенерирует
    # хвост отчёта, не показывая пользователю обрыв на полуслове.
    response = llm.chat_continued(
        [Message(role="user", content=prompt)],
        temperature=0.2,
        max_tokens=4000,
        continuation_instruction=(
            "Продолжи отчёт о дефекте точно с того места, где текст оборвался. "
            "НЕ повторяй уже написанное. Не забудь завершить строкой «Приоритет: X»."
        ),
    )
    return response.content.strip()


def _parse_report(report: str) -> dict:
    """Разбирает структурированный отчёт на части для автоподстановки в Jira."""
    title = ""
    priority = ""

    m = re.search(r"^#\s+(.+)$", report, flags=re.M)
    if m:
        title = m.group(1).strip().strip("`").strip()

    # «Приоритет: Высокий» — последняя такая строка; терпим лишний текст вокруг
    for pm in re.finditer(r"^\s*\*{0,2}Приоритет\*{0,2}\s*[:\-]\s*(.+)$", report, flags=re.M):
        raw = pm.group(1)
        for p in _PRIORITIES:
            if p.lower() in raw.lower():
                priority = p
        # если конкретное слово не найдено — берём первое слово строки
        if not priority:
            priority = raw.strip().split()[0].strip("*`") if raw.strip() else ""

    # Описание: всё между строкой названия и строкой приоритета
    desc = report
    if m:
        desc = report[m.end():]
    desc = re.sub(r"^\s*\*{0,2}Приоритет\*{0,2}\s*[:\-].*$", "", desc, flags=re.M).strip()

    return {"title": title, "description": desc, "priority": priority}


@router.post("/api/bugs/format", response_model=BugFormatResponse)
async def format_bug(
    platform: str = Form(...),
    feature: str = Form(""),
    description: str = Form(...),
    provider: str = Form(...),
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

    provider = provider.strip()
    if not provider:
        raise HTTPException(
            status_code=400,
            detail={"message": "LLM-провайдер не выбран", "llm_error": False},
        )

    try:
        report = await asyncio.to_thread(
            _format_bug_sync,
            platform, feature, full_description, provider
        )
        return {"report": report, **_parse_report(report)}
    except Exception as e:
        from agents.llm_client import LLMClient
        is_llm, friendly = LLMClient.classify_error(e)
        raise HTTPException(
            status_code=503 if is_llm else 500,
            detail={"message": friendly, "llm_error": is_llm}
        )
