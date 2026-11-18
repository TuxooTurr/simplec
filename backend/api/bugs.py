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
from pydantic import BaseModel, Field, Json
from backend.schemas import BugFormatResponse

router = APIRouter()

_PRIORITIES = ("Критический", "Высокий", "Средний", "Низкий")
_LAYER_CODES = "Bc — бэкенд, Fn — фронтенд, Mb — мобильное приложение, An — аналитика, Ds — дизайн, Dv — DevOps/инфраструктура"
_DEFECT_TITLE = re.compile(r"\[(Bc|Fn|Mb|An|Ds|Dv)\]\[([^\[\]\n]+)\]\s+(.+)", re.I)
_COMPONENT_LINE = re.compile(r"^Компонент Jira:[ \t]*(\d+)[ \t]*$", re.M)
_REQUIREMENTS_LIMIT = 24000


class JiraFormatContext(BaseModel):
    summary: str = Field("", max_length=250)
    epic: str = Field("", max_length=40)
    epic_summary: str = Field("", max_length=500)
    components: list[str] = Field(default_factory=list)
    selected_components: list[str] = Field(default_factory=list)
    attachment_names: list[str] = Field(default_factory=list)
    confluence_ref: str = Field("", max_length=2000)
    allow_without_requirements: bool = False

    def instructions(self) -> tuple[str, str]:
        context = f"\nЭПИК: {self.epic} {self.epic_summary}" if self.epic else ""
        if self.summary:
            context += f"\nЧЕРНОВОЕ НАЗВАНИЕ: {self.summary}"
        if self.attachment_names:
            context += "\nВЛОЖЕНИЯ БЕЗ ТЕКСТА (только имена): " + ", ".join(self.attachment_names)
        if self.selected_components:
            context += "\nКОМПОНЕНТЫ, ВЫБРАННЫЕ ПОЛЬЗОВАТЕЛЕМ: " + ", ".join(self.selected_components)
        if self.selected_components or not self.components:
            return context, ""
        context += ("\nПо фиче и слою выбери наиболее подходящий компонент из списка Jira ниже. "
                    "Сразу после заголовка напиши отдельную строку «Компонент Jira: N», где N — номер из списка "
                    "или 0, если подходящего нет. Это служебная строка, не раздел отчёта.\n")
        context += "\n".join(f"{i}. {name}" for i, name in enumerate(self.components, 1))
        return context, "\nКомпонент Jira: <номер или 0>"

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


def _format_bug_sync(platform: str, feature: str, description: str, provider: str, requirements_context: str = "",
                     jira: JiraFormatContext | None = None) -> str:
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)

    feature_hint = f"\nФИЧА / МОДУЛЬ (подсказка): {feature.strip()}" if feature.strip() else ""
    requirements_block = f"\n\n═══════════════════════════════════════════════════\nКОНТЕКСТ ИЗ ТРЕБОВАНИЙ (для справки — реальные поля БД, методы API, бизнес-правила; используй, чтобы точнее и конкретнее описать дефект, но не выдумывай то, чего нет во входных данных)\n═══════════════════════════════════════════════════\n{requirements_context}" if requirements_context.strip() else ""
    jira_context, component_line = jira.instructions() if jira else ("", "")
    layer = (
        f"Выбери по входным данным один код слоя: {_LAYER_CODES}. Учитывай выбранный компонент как подсказку. "
        "При неоднозначности выбери наиболее вероятный слой."
        if jira else f"КОМПОНЕНТ/СЛОЙ (выбран пользователем, не меняй): {platform}"
    )
    title_prefix = "[КодСлоя][НазваниеМодуля]" if jira else f"[{platform}][НазваниеМодуля]"

    prompt = f"""Ты — опытный QA-инженер. Ты превращаешь краткие, неформальные описания проблем (часто с ошибками, без структуры, с фрагментами JSON, логов, скринов) в чёткий структурированный дефект для Jira.

{layer}{feature_hint}{jira_context}

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
5. Название строго: `{title_prefix} Краткая суть` (до 100 символов). [НазваниеМодуля] — экран/операция/модуль; если пользователь указал фичу — используй её.
6. Шаги — минимум, нужный для воспроизведения, как их выполнит тестировщик.
7. Отвечай на языке входных данных. Только Markdown. Разделы — ровно из шаблона, в том же порядке; других разделов не добавляй.
8. САМАЯ ПОСЛЕДНЯЯ строка ответа — ВСЕГДА отдельная строка ровно вида «Приоритет: X», где X — одно слово: Критический, Высокий, Средний, Низкий. Критический — ключевой функционал недоступен, обхода нет; Высокий — важный функционал заблокирован; Средний — есть обходной путь; Низкий — косметика.

═══════════════════════════════════════════════════
СТРОГИЙ ШАБЛОН ОТВЕТА (ровно эта структура)
═══════════════════════════════════════════════════

# {title_prefix} Краткая суть дефекта{component_line}

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


async def _collect_attachments(attachments: List[UploadFile]) -> tuple[str, list[str]]:
    """Текст вложений и имена скриншотов."""
    from agents.file_parser import parse_file

    attachment_texts = []
    screenshot_names: list[str] = []
    for idx, f in enumerate(attachments):
        if not (f and f.filename):
            continue
        if is_image(f.filename):
            screenshot_names.append(safe_attachment_name(f.filename, idx))
        try:
            data = await f.read()
            text = await asyncio.to_thread(parse_file, data, f.filename)
            attachment_texts.append(f"[{f.filename}]:\n{text}")
        except Exception as e:
            attachment_texts.append(f"[{f.filename}]: не удалось прочитать — {e}")

    attachments_block = ("\n\n─── ВЛОЖЕНИЯ ───\n" + "\n\n".join(attachment_texts)) if attachment_texts else ""
    return attachments_block, screenshot_names


def _linked_requirements(requirement_ids: list[str]) -> str:
    from db.requirements_store import RequirementsStore

    reqs = [RequirementsStore.get_requirement(rid) for rid in requirement_ids]
    return "\n\n".join(f"### {r['name']}\n{r['text']}" for r in reqs if r and (r.get("text") or "").strip())


async def _requirements_context(requirement_ids: list[str], jira: JiraFormatContext | None,
                                source_file: UploadFile | None) -> str | None:
    """None — форма Jira должна предложить указать источник требований."""
    linked = _linked_requirements(requirement_ids)
    if not jira or linked:
        return linked[:_REQUIREMENTS_LIMIT] if jira else linked
    if source_file and source_file.filename:
        from agents.file_parser import parse_file

        try:
            data = await source_file.read()
            text = await asyncio.to_thread(parse_file, data, source_file.filename, True)
        except ValueError as e:
            raise HTTPException(422, f"Не удалось прочитать файл требований: {e}") from e
        if text.strip():
            return f"### {source_file.filename}\n{text}"[:_REQUIREMENTS_LIMIT]
    if jira.confluence_ref.strip():
        from backend.api.requirements import fetch_page

        page = await asyncio.to_thread(fetch_page, jira.confluence_ref.strip())
        if page["markdown"].strip():
            return f"### {page['title']}\n{page['markdown']}"[:_REQUIREMENTS_LIMIT]
    return "" if jira.allow_without_requirements else None


def _jira_report(report: str, screenshots: list[str], jira: JiraFormatContext, *, defect: bool) -> dict:
    component = ""
    report = report.replace("\r\n", "\n")
    if not jira.selected_components and jira.components:
        match = _COMPONENT_LINE.search(report)
        if match:
            index = int(match.group(1))
            if 1 <= index <= len(jira.components):
                component = jira.components[index - 1]
            report = _COMPONENT_LINE.sub("", report, count=1)
    parsed = _parse_report(report)
    title = parsed["title"]
    if defect and (match := _DEFECT_TITLE.fullmatch(title)):
        code, feature, summary = match.groups()
        title = f"[{code.capitalize()}][{feature.strip()}] {summary.strip()}" if feature.strip() else ""
        report = re.sub(r"^#\s+.+$", lambda _: f"# {title}", report, count=1, flags=re.M)
    elif defect:
        title = ""
    if not title or not parsed["description"]:
        raise HTTPException(502, detail={"message": "Модель не вернула название и описание в нужном формате", "llm_error": True})
    report = with_screenshots(report, screenshots)
    return {**_parse_report(report), "report": report, "screenshots": screenshots, "component": component}


def _format_task_sync(feature: str, description: str, provider: str, requirements_context: str = "",
                      jira: JiraFormatContext | None = None) -> str:
    """Задача (не дефект): название и описание по свободному тексту + требованиям."""
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)
    feature_hint = f"\nФИЧА / МОДУЛЬ (подсказка): {feature.strip()}" if feature.strip() else ""
    requirements_block = (
        "\n\n═══ КОНТЕКСТ ИЗ ТРЕБОВАНИЙ (используй, чтобы задача была конкретной и соответствовала требованиям; "
        f"не выдумывай того, чего нет) ═══\n{requirements_context}"
    ) if requirements_context.strip() else ""
    jira_context, component_line = jira.instructions() if jira else ("", "")

    prompt = f"""Ты — опытный QA-лид. Оформи задачу для Jira по неформальному описанию.{feature_hint}{jira_context}

ВХОДНЫЕ ДАННЫЕ:
{description}{requirements_block}

ПРАВИЛА:
1. Коротко и по сути, без вводных слов. Одна задача.
2. Не выдумывай конкретику (ID, стенды, версии), которой нет во входных данных.
3. Название — до 100 символов, глагол в начале («Проверить…», «Подготовить…», «Автоматизировать…»).
4. Только Markdown, ровно разделы шаблона, в том же порядке. Раздел без данных — опусти.

ШАБЛОН ОТВЕТА:

# Название задачи{component_line}

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
    jira_context: Json[JiraFormatContext] | None = Form(None),
    requirement_file: UploadFile | None = File(None),
):
    """Генерация задачи: название + описание. Источник для ИИ — требования из раздела «Данные»."""
    provider = provider.strip()
    if not provider:
        raise HTTPException(status_code=400, detail={"message": "LLM-провайдер не выбран", "llm_error": False})
    requirements_context = await _requirements_context(requirement_ids, jira_context, requirement_file)
    if requirements_context is None:
        return {"report": "", "needs_requirements": True}
    attachments_block, screenshots = await _collect_attachments(attachments)
    try:
        report = await asyncio.to_thread(
            _format_task_sync, feature, description + attachments_block, provider, requirements_context, jira_context,
        )
        if jira_context:
            return {**_jira_report(report, screenshots, jira_context, defect=False), "priority": ""}
        parsed = _parse_report(report)
        return {"report": report, "screenshots": [], **parsed, "priority": ""}
    except HTTPException:
        raise
    except Exception as e:
        from agents.llm_client import LLMClient
        is_llm, friendly = LLMClient.classify_error(e)
        raise HTTPException(status_code=503 if is_llm else 500, detail={"message": friendly, "llm_error": is_llm})


# ── Чек-лист фичи по требованиям (Jira tool → «Чек-лист») ────────────────────

# Требования бывают длинными; контекст режем, чтобы запрос влез в окно модели.
_CHECKLIST_CONTEXT_LIMIT = 12000
_CHECK_LINE_RE = re.compile(r"^\s*(?:\d+[.)]|[-*•])\s+(.+?)\s*$")


class ChecklistBody(BaseModel):
    key: str = Field("", max_length=40)
    summary: str = Field(..., min_length=1, max_length=500)
    requirement_ids: List[str] = Field(default_factory=list, max_length=20)
    provider: str = Field(..., min_length=1)


def parse_checks(text: str) -> list[str]:
    """Ответ модели → пункты проверок: нумерованные или маркированные строки, без пустых и повторов."""
    out: list[str] = []
    for line in text.splitlines():
        m = _CHECK_LINE_RE.match(line)
        # Жирный и курсив из Markdown модели убираем: в чате у Сберчата своя разметка (*жирный*).
        item = re.sub(r"\*\*|__", "", m.group(1) if m else "").strip().strip("*_ ")
        if item and item not in out:
            out.append(item)
    return out


def _checklist_sync(summary: str, requirements_context: str, provider: str) -> str:
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)
    prompt = f"""Ты — опытный QA-лид. По требованиям составь критически важные базовые проверки фичи.

ФИЧА: {summary}

═══ ТРЕБОВАНИЯ (единственный источник; не выдумывай того, чего в них нет) ═══
{requirements_context}

ПРАВИЛА:
1. Только самое важное: 3–8 проверок, без которых фичу нельзя считать рабочей.
2. Язык бизнес-пользователя, без технических терминов, API, SQL и кода — проверку должен провести
   младший специалист сопровождения, впервые видящий фичу.
3. Каждая проверка — одна строка: что сделать → что должно получиться.
   Пример: «Откройте карточку инцидента и нажмите „Взять в работу“ — статус сменится на „В работе“».
4. Ответ — только нумерованный список «1. …», без заголовков, вступлений и выводов."""

    response = llm.chat([Message(role="user", content=prompt)], temperature=0.2, max_tokens=1500)
    return response.content.strip()


@router.post("/api/tasks/checklist")
async def task_checklist(body: ChecklistBody) -> dict:
    """Критически важные базовые проверки фичи по её требованиям из раздела «Данные»."""
    context = _linked_requirements(body.requirement_ids)[:_CHECKLIST_CONTEXT_LIMIT]
    if not context:
        raise HTTPException(status_code=400, detail={"message": "У фичи нет требований с текстом", "llm_error": False})
    try:
        text = await asyncio.to_thread(_checklist_sync, body.summary, context, body.provider.strip())
    except Exception as e:
        from agents.llm_client import LLMClient
        is_llm, friendly = LLMClient.classify_error(e)
        raise HTTPException(status_code=503 if is_llm else 500, detail={"message": friendly, "llm_error": is_llm})
    checks = parse_checks(text)
    if not checks:
        raise HTTPException(status_code=502, detail={"message": "Модель не вернула список проверок", "llm_error": True})
    return {"key": body.key, "checks": checks}


@router.post("/api/bugs/format", response_model=BugFormatResponse)
async def format_bug(
    platform: str = Form(""),
    feature: str = Form(""),
    description: str = Form(...),
    provider: str = Form(...),
    attachments: List[UploadFile] = File(default=[]),
    requirement_ids: List[str] = Form(default=[]),
    jira_context: Json[JiraFormatContext] | None = Form(None),
    requirement_file: UploadFile | None = File(None),
):
    # Вложения: текст — в контекст, скриншоты — ещё и картинками в описание (раздел «Скриншоты»).
    # Требования — контекст из раздела «Данные» (фича/API/поля БД — для точности дефекта).
    provider = provider.strip()
    if not provider:
        raise HTTPException(
            status_code=400,
            detail={"message": "LLM-провайдер не выбран", "llm_error": False},
        )
    if not jira_context and not platform.strip():
        raise HTTPException(422, "Укажите платформу")
    requirements_context = await _requirements_context(requirement_ids, jira_context, requirement_file)
    if requirements_context is None:
        return {"report": "", "needs_requirements": True}
    attachments_block, screenshot_names = await _collect_attachments(attachments)

    try:
        report = await asyncio.to_thread(
            _format_bug_sync,
            platform, feature, description + attachments_block, provider, requirements_context, jira_context,
        )
        if jira_context:
            return _jira_report(report, screenshot_names, jira_context, defect=True)
        report = with_screenshots(report, screenshot_names)
        return {"report": report, "screenshots": screenshot_names, **_parse_report(report)}
    except HTTPException:
        raise
    except Exception as e:
        from agents.llm_client import LLMClient
        is_llm, friendly = LLMClient.classify_error(e)
        raise HTTPException(
            status_code=503 if is_llm else 500,
            detail={"message": friendly, "llm_error": is_llm}
        )
