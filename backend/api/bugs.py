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

_IMAGE_EXTS = (".png", ".jpg", ".jpeg")

# Jira ссылается на вложение по имени файла, поэтому имя должно пережить путь
# «загрузка → создание дефекта → вложение» без изменений. Пробелы и кириллица
# в разметке !имя! ломают отображение, поэтому имя приводим к безопасному виду
# один раз здесь, и то же имя потом уходит во вложение.
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def is_image(filename: str) -> bool:
    return filename.lower().endswith(_IMAGE_EXTS)


def safe_attachment_name(filename: str, index: int) -> str:
    """Имя вложения, одинаковое в описании и в самом файле."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    stem = _SAFE_NAME_RE.sub("_", stem).strip("._-")
    # Имя без единой буквы или цифры («...», «___») Jira покажет как мусор —
    # такие заменяем на предсказуемое screenshot_N.
    if not any(c.isalnum() for c in stem):
        stem = f"screenshot_{index + 1}"
    return f"{stem}.{ext}"


def with_screenshots(report: str, names: list[str]) -> str:
    """Добавляет в отчёт раздел «Скриншоты» с картинками.

    Разметка изображений в Jira превращается в !имя|thumbnail! (см. _md_to_jira),
    и скрин виден прямо в описании дефекта, а не только висит вложением.
    Раньше от картинки в описание попадал лишь распознанный текст (OCR).

    Раздел вставляется ПЕРЕД строкой «Приоритет: X»: она по шаблону последняя,
    и разбор отчёта опирается на это.
    """
    if not names:
        return report

    block = "\n".join(["", "## Скриншоты", ""] + [f"![{n}]({n})" for n in names])

    matches = list(re.finditer(r"^\s*\*{0,2}Приоритет\*{0,2}\s*[:\-].*$", report, flags=re.M))
    if not matches:
        return report.rstrip() + "\n" + block
    last = matches[-1]
    return report[:last.start()].rstrip() + "\n" + block + "\n\n" + report[last.start():]


def _format_bug_sync(platform: str, feature: str, description: str, provider: str, requirements_context: str = "") -> str:
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)

    feature_hint = f"\nФИЧА / МОДУЛЬ (подсказка): {feature.strip()}" if feature.strip() else ""
    requirements_block = f"\n\n═══════════════════════════════════════════════════\nКОНТЕКСТ ИЗ ТРЕБОВАНИЙ (для справки — реальные поля БД, методы API, бизнес-правила; используй, чтобы точнее и конкретнее описать дефект, но не выдумывай то, чего нет во входных данных)\n═══════════════════════════════════════════════════\n{requirements_context}" if requirements_context.strip() else ""

    prompt = f"""Ты — опытный QA-инженер. Ты превращаешь краткие, неформальные описания проблем (часто с ошибками, без структуры, с фрагментами JSON, логов, скринов) в чёткий структурированный дефект для Jira.

КОМПОНЕНТ/СЛОЙ (выбран пользователем, не меняй): {platform}{feature_hint}

ВХОДНЫЕ ДАННЫЕ (могут быть неполными, с ошибками; вложения приложены ниже текстом):
{description}{requirements_block}

═══════════════════════════════════════════════════
ПРИНЦИПЫ РАБОТЫ
═══════════════════════════════════════════════════
1. КОРОТКО И ПО СУТИ. Читатель должен понять дефект за 10 секунд. Без вводных слов, повторов, общих фраз и рассуждений о причинах.
2. Оформи ОДИН дефект. Если во входных данных несколько проблем — оформи главную, остальные одной строкой в конце «Описание»: «Возможно, отдельные дефекты: …».
3. НЕ ВЫДУМЫВАЙ конкретные данные (ID, тексты ошибок, версии, стенды, учётки). Нет в данных — не пиши.
4. ВЛОЖЕНИЯ ИЗУЧИ ВСЕ:
   - Скриншоты приходят распознанным текстом (блок «[имя_файла]») — используй, чтобы точно описать, что не так.
   - Из логов/JSON/ответов API бери ТОЛЬКО ключевую строку (ошибка, код ответа) — в code-блок ``` как есть. Не весь лог.
5. Название строго: `[{platform}][НазваниеМодуля] Краткая суть` (до 100 символов). [НазваниеМодуля] — экран/операция/модуль; если пользователь указал фичу — используй её.
6. Шаги — минимум, нужный для воспроизведения, как их выполнит тестировщик.
7. Отвечай на языке входных данных. Только Markdown. Разделы — ровно из шаблона, в том же порядке; других разделов не добавляй.
8. САМАЯ ПОСЛЕДНЯЯ строка ответа — ВСЕГДА отдельная строка ровно вида «Приоритет: X», где X — одно слово: Критический, Высокий, Средний, Низкий. Критический — ключевой функционал недоступен, обхода нет; Высокий — важный функционал заблокирован; Средний — есть обходной путь; Низкий — косметика.

═══════════════════════════════════════════════════
СТРОГИЙ ШАБЛОН ОТВЕТА (ровно эта структура)
═══════════════════════════════════════════════════

# [{platform}][НазваниеМодуля] Краткая суть дефекта

## Описание
1–2 предложения: что сломано и где.

## Предусловия
1. ... *(раздел опусти, если предусловий нет)*

## Шаги воспроизведения
1. ...
2. ...

## Фактический результат
Что происходит. Ключевой фрагмент ошибки — в code-блоке, если есть.

## Ожидаемый результат
Как должно быть.

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


async def _collect_context(attachments: List[UploadFile], requirement_ids: List[str]) -> tuple[str, list[str], str]:
    """Текст вложений, имена скриншотов и контекст из требований (раздел «Данные»)."""
    from agents.file_parser import parse_file
    from db.requirements_store import RequirementsStore

    attachment_texts = []
    screenshot_names: list[str] = []
    for idx, f in enumerate(attachments):
        if not (f and f.filename):
            continue
        if is_image(f.filename):
            screenshot_names.append(safe_attachment_name(f.filename, idx))
        try:
            data = await f.read()
            text = parse_file(data, f.filename)
            attachment_texts.append(f"[{f.filename}]:\n{text}")
        except Exception as e:
            attachment_texts.append(f"[{f.filename}]: не удалось прочитать — {e}")

    requirements_context = ""
    if requirement_ids:
        reqs = [RequirementsStore.get_requirement(rid) for rid in requirement_ids]
        blocks = [f"### {r['name']}\n{r['text']}" for r in reqs if r]
        requirements_context = "\n\n".join(blocks)

    attachments_block = ("\n\n─── ВЛОЖЕНИЯ ───\n" + "\n\n".join(attachment_texts)) if attachment_texts else ""
    return attachments_block, screenshot_names, requirements_context


def _format_task_sync(feature: str, description: str, provider: str, requirements_context: str = "") -> str:
    """Задача (не дефект): название и описание по свободному тексту + требованиям."""
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)
    feature_hint = f"\nФИЧА / МОДУЛЬ (подсказка): {feature.strip()}" if feature.strip() else ""
    requirements_block = (
        "\n\n═══ КОНТЕКСТ ИЗ ТРЕБОВАНИЙ (используй, чтобы задача была конкретной и соответствовала требованиям; "
        f"не выдумывай того, чего нет) ═══\n{requirements_context}"
    ) if requirements_context.strip() else ""

    prompt = f"""Ты — опытный QA-лид. Оформи задачу для Jira по неформальному описанию.{feature_hint}

ВХОДНЫЕ ДАННЫЕ:
{description}{requirements_block}

ПРАВИЛА:
1. Коротко и по сути, без вводных слов. Одна задача.
2. Не выдумывай конкретику (ID, стенды, версии), которой нет во входных данных.
3. Название — до 100 символов, глагол в начале («Проверить…», «Подготовить…», «Автоматизировать…»).
4. Только Markdown, ровно разделы шаблона, в том же порядке. Раздел без данных — опусти.

ШАБЛОН ОТВЕТА:

# Название задачи

## Цель
1–2 предложения: зачем задача.

## Что сделать
1. ...

## Критерии готовности
- ...

## Контекст
Ссылки на требования и важные детали из входных данных."""

    response = llm.chat_continued(
        [Message(role="user", content=prompt)],
        temperature=0.2,
        max_tokens=3000,
        continuation_instruction="Продолжи описание задачи точно с места обрыва, не повторяя написанное.",
    )
    return response.content.strip()


@router.post("/api/tasks/format", response_model=BugFormatResponse)
async def format_task(
    feature: str = Form(""),
    description: str = Form(...),
    provider: str = Form(...),
    attachments: List[UploadFile] = File(default=[]),
    requirement_ids: List[str] = Form(default=[]),
):
    """Генерация задачи: название + описание. Источник для ИИ — требования из раздела «Данные»."""
    attachments_block, _shots, requirements_context = await _collect_context(attachments, requirement_ids)
    provider = provider.strip()
    if not provider:
        raise HTTPException(status_code=400, detail={"message": "LLM-провайдер не выбран", "llm_error": False})
    try:
        report = await asyncio.to_thread(
            _format_task_sync, feature, description + attachments_block, provider, requirements_context,
        )
        parsed = _parse_report(report)
        return {"report": report, "screenshots": [], **parsed, "priority": ""}
    except Exception as e:
        from agents.llm_client import LLMClient
        is_llm, friendly = LLMClient.classify_error(e)
        raise HTTPException(status_code=503 if is_llm else 500, detail={"message": friendly, "llm_error": is_llm})


@router.post("/api/bugs/format", response_model=BugFormatResponse)
async def format_bug(
    platform: str = Form(...),
    feature: str = Form(""),
    description: str = Form(...),
    provider: str = Form(...),
    attachments: List[UploadFile] = File(default=[]),
    requirement_ids: List[str] = Form(default=[]),
):
    # Вложения: текст — в контекст, скриншоты — ещё и картинками в описание (раздел «Скриншоты»).
    # Требования — контекст из раздела «Данные» (фича/API/поля БД — для точности дефекта).
    attachments_block, screenshot_names, requirements_context = await _collect_context(attachments, requirement_ids)
    full_description = description + attachments_block

    provider = provider.strip()
    if not provider:
        raise HTTPException(
            status_code=400,
            detail={"message": "LLM-провайдер не выбран", "llm_error": False},
        )

    try:
        report = await asyncio.to_thread(
            _format_bug_sync,
            platform, feature, full_description, provider, requirements_context,
        )
        report = with_screenshots(report, screenshot_names)
        return {"report": report, "screenshots": screenshot_names, **_parse_report(report)}
    except Exception as e:
        from agents.llm_client import LLMClient
        is_llm, friendly = LLMClient.classify_error(e)
        raise HTTPException(
            status_code=503 if is_llm else 500,
            detail={"message": friendly, "llm_error": is_llm}
        )
