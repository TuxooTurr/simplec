"""
Сценарии сравнения LLM-моделей — сохранённые дефолты промпта, транскрибации
и рекомендаций судье.

При выборе сценария в "Тестировании моделей LLM" поля "Промпт" и "Транскрибация"
предзаполняются его значениями — пользователь может их заменить перед запуском,
дефолт только подставляется, ничего не блокирует. judge_instructions — доп.
инструкции для модели-судьи при оценке качества (что именно важно проверить
в контексте этого сценария), добавляются к промпту судьи поверх штатных
технических метрик.

Файл: data/model_bench_scenarios.json — тот же паттерн атомарной записи и
восстановления при битом JSON, что и в db/requirements_store.py.

При первом запуске (файла ещё нет) сюда сеется встроенный сценарий
"Транскрибация" — типовая саммаризация инцидента (промпт с реального
продакшена) с готовыми критериями оценки для судьи, чтобы не начинать
с пустого списка на каждой новой машине/деплое.
"""

import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent
_FILE = _ROOT / "data" / "model_bench_scenarios.json"
_MAX_ITEMS = 100

_BUILTIN_TRANSCRIPT_PROMPT = """Ты агент, позволяющий получить саммаризацию транскрибации аудиоконференции в виде основных итогов по встрече. На встрече обсуждается возникший инцидент в Банке.

**Контекст**: В работе Банка возникают инциденты. Каждый инцидент разбирается на отдельной аудиоконференции. Сотрудники Банка постепенно подключаются к этой конференции и обсуждают различные аспекты данного инцидента и способы его решения. В ходе конференции по мере надобности могут приглашаться другие специалисты-сотрудники Банка.
**Формат данных**: Транскрибация представляет собой текст, содержащий все произнесенные на этой конференции фразы. Фразы идут одна за другой без привязки к спикеру.
**Инструкция**: Тебе нужно составить КРАТКИЕ итоги встречи, в котором упомянуть что произошло в Банке, причину возникновения инцидента, время возникновения инцидента, что делается (или было сделано) для устранения инцидента, решения, которые были приняты в ходе конференции. Ответ отформатируй с использованием markdown.
**Очень важное уточнение**: текст составленной тобою саммаризации не должен превышать 10000 символов!"""

# Критерии оценки — синтез общепринятых измерений качества саммаризации
# (faithfulness/factual consistency, coverage, coherence, conciseness,
# relevance — см. SummEval и аналогичные фреймворки LLM-as-judge) применительно
# к специфике инцидент-саммари: важны время/причина/действия/решения и
# отсутствие галлюцинаций на технических деталях (коды ошибок, системы, время).
_BUILTIN_TRANSCRIPT_JUDGE_INSTRUCTIONS = """Оценивай саммаризацию по двум группам критериев — технической и логической.

ТЕХНИЧЕСКАЯ ТОЧНОСТЬ:
1. Фактическая достоверность — нет ли в саммари фактов, которых не было в транскрибации (галлюцинации: придуманные системы, коды ошибок, цифры, имена).
2. Сохранность ключевых технических деталей — названия систем/сервисов, коды ошибок, временные метки, числовые показатели должны быть перенесены точно, без искажений.
3. Хронологическая точность — последовательность событий (когда началось, когда обнаружили, когда устранили) не должна быть перепутана или искажена относительно транскрибации.
4. Полнота обязательных элементов — что произошло, причина инцидента, время возникновения, предпринятые/принятые меры, принятые решения. Отсутствие любого из них при наличии этой информации в транскрибации — существенный минус.

ЛОГИКА НАПИСАНИЯ И САММАРИЗАЦИИ:
5. Связность и структура — текст должен читаться как цельный связный отчёт, а не набор разрозненных фраз; использование markdown оправдано и облегчает восприятие.
6. Отсутствие дублирования — одна и та же мысль не повторяется разными словами в разных местах.
7. Релевантность — исключён технический шум транскрибации (приветствия, повторы, обрывки не по теме), сохранено только то, что относится к сути инцидента.
8. Лаконичность при сохранении сути — соблюдён лимit по объёму (в промпте — 10000 символов), информация не разбавлена водой ради объёма и не сжата до потери смысла.
9. Стиль — деловой, нейтральный, без домыслов и оценочных суждений от лица модели ("возможно", "видимо" — недопустимы, если это не явно вопрос для уточнения).

При оценке явно отмечай, по каким из этих девяти пунктов есть замечания, а по каким — модель справилась хорошо. Не придумывай нарушения, которых не видно в реальном выводе модели."""


class ModelBenchScenariosStore:

    @staticmethod
    def _load() -> list[dict]:
        if not _FILE.exists():
            return ModelBenchScenariosStore._seed_defaults()
        try:
            with open(_FILE, encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            backup = _FILE.with_suffix(f".json.corrupted-{int(datetime.now().timestamp())}")
            try:
                shutil.move(str(_FILE), str(backup))
                logger.warning("model_bench_scenarios.json битый, перемещён в %s", backup)
            except OSError:
                logger.warning("model_bench_scenarios.json битый и не удалось сохранить копию")
            return ModelBenchScenariosStore._seed_defaults()

    @staticmethod
    def _seed_defaults() -> list[dict]:
        """Первый запуск (файла ещё нет) — сеет встроенный сценарий "Транскрибация",
        чтобы на каждой новой машине/деплое не начинать со пустого списка сценариев."""
        now = datetime.now(timezone.utc).isoformat()
        items = [{
            "id": uuid.uuid4().hex[:12],
            "name": "Транскрибация",
            "prompt": _BUILTIN_TRANSCRIPT_PROMPT,
            "transcript": "",
            "judge_instructions": _BUILTIN_TRANSCRIPT_JUDGE_INSTRUCTIONS,
            "created_at": now,
        }]
        ModelBenchScenariosStore._save(items)
        return items

    @staticmethod
    def _save(items: list[dict]) -> None:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = _FILE.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, _FILE)

    @classmethod
    def list_scenarios(cls) -> list[dict]:
        return sorted(cls._load(), key=lambda i: i.get("created_at", ""), reverse=True)

    @classmethod
    def add_scenario(cls, name: str, prompt: str, transcript: str, judge_instructions: str = "") -> dict:
        now = datetime.now(timezone.utc).isoformat()
        item = {
            "id": uuid.uuid4().hex[:12],
            "name": name.strip(),
            "prompt": prompt,
            "transcript": transcript,
            "judge_instructions": judge_instructions,
            "created_at": now,
        }
        items = cls._load()
        items.insert(0, item)
        items = items[:_MAX_ITEMS]
        cls._save(items)
        return item

    @classmethod
    def delete_scenario(cls, scenario_id: str) -> bool:
        items = cls._load()
        before = len(items)
        items = [i for i in items if i.get("id") != scenario_id]
        if len(items) == before:
            return False
        cls._save(items)
        return True
