"""
Сравнение LLM-моделей на саммаризации транскрибаций.

Прогон: один и тот же (промпт + транскрибация) отправляется N раз одной
модели — фиксируются время ответа и токены. Повторяется для нескольких
моделей. По накопленным прогонам отдельная LLM-модель ("судья") пишет
сравнительный отчёт по качеству саммари, опираясь на реально измеренные
(не придуманные ей) технические метрики.
"""
import re
import time

from agents.llm_client import LLMClient, Message

_BEST_MARKER_RE = re.compile(r"^ЛУЧШАЯ_МОДЕЛЬ:\s*(\S+)::(.*)$", re.MULTILINE)

# Таймаут HTTP-клиента при тестировании моделей — заметно выше обычного чата
# (GigaChat 120с / custom-провайдеры 180с по умолчанию, см. LLMClient). Локальные
# и однопоточные модели (Ollama/LM Studio и т.п.) во время замера иногда заняты
# чужим запросом и отвечают дольше обычного — 3 минуты дают им шанс, а не рвут
# соединение на середине.
_BENCH_TIMEOUT_SEC = 180.0


def run_model_batch(provider: str, model: str, prompt: str, transcript: str, runs: int) -> list[dict]:
    """N независимых вызовов одной модели с одним и тем же промптом+транскрибацией.

    Ошибка в одном прогоне не должна убивать остальные — фиксируем её в самом
    прогоне (`error`), а не бросаем исключение наружу."""
    client = LLMClient(provider=provider, timeout=_BENCH_TIMEOUT_SEC)
    messages = [
        Message(role="system", content=prompt),
        Message(role="user", content=transcript),
    ]
    results = []
    for i in range(runs):
        started = time.time()
        try:
            resp = client.chat(messages, temperature=0.3, max_tokens=2000, model=model)
            # Пустой ответ при finish_reason="stop" — не ошибка API (исключения не было),
            # а деградация модели: она "ответила", но саммари в этом ответе нет. Раньше это
            # тихо сохранялось как успешный прогон с пустым output_text — неотличимо от
            # настоящего пустого саммари. Одна свежая попытка (не продолжение) обычно чинит это.
            if not resp.content.strip():
                resp = client.chat(messages, temperature=0.3, max_tokens=2000, model=model)
            elapsed = time.time() - started
            usage = resp.usage or {}
            tokens_out = usage.get("completion_tokens", 0)
            if not resp.content.strip():
                results.append({
                    "run": i + 1,
                    "output_text": "",
                    "latency_sec": round(elapsed, 2),
                    "tokens_in": usage.get("prompt_tokens", 0),
                    "tokens_out": tokens_out,
                    "tokens_per_sec": 0,
                    "finish_reason": resp.finish_reason,
                    "error": "Модель вернула пустой ответ (после повторной попытки)",
                })
                continue
            results.append({
                "run": i + 1,
                "output_text": resp.content,
                "latency_sec": round(elapsed, 2),
                "tokens_in": usage.get("prompt_tokens", 0),
                "tokens_out": tokens_out,
                "tokens_per_sec": round(tokens_out / elapsed, 1) if elapsed > 0 and tokens_out else 0,
                "finish_reason": resp.finish_reason,
                "error": None,
            })
        except Exception as e:
            _, friendly = LLMClient.classify_error(e)
            results.append({
                "run": i + 1,
                "output_text": "",
                "latency_sec": round(time.time() - started, 2),
                "tokens_in": 0,
                "tokens_out": 0,
                "tokens_per_sec": 0,
                "finish_reason": "",
                "error": friendly[:300],
            })
    return results


def target_stats(target: dict) -> dict:
    """Технические метрики по одной модели — считаются в коде из измеренных
    прогонов (не LLM), поэтому гарантированно точны и годятся и для отчёта
    в UI, и для PPTX-экспорта, и как факт для судьи."""
    all_runs = target.get("results", [])
    ok_runs = [r for r in all_runs if not r.get("error")]
    n = len(ok_runs)
    avg = lambda key: round(sum(r[key] for r in ok_runs) / n, 2) if n else 0

    latencies = sorted(r["latency_sec"] for r in ok_runs)

    def _median(vals: list[float]) -> float:
        if not vals:
            return 0
        mid = len(vals) // 2
        if len(vals) % 2:
            return round(vals[mid], 2)
        return round((vals[mid - 1] + vals[mid]) / 2, 2)

    return {
        "provider": target.get("provider", ""),
        "model": target.get("model", ""),
        "runs_total": len(all_runs),
        "runs_ok": n,
        "success_rate": round(100 * n / len(all_runs), 1) if all_runs else 0,
        "avg_latency_sec": avg("latency_sec"),
        "min_latency_sec": round(latencies[0], 2) if latencies else 0,
        "max_latency_sec": round(latencies[-1], 2) if latencies else 0,
        "median_latency_sec": _median(latencies),
        "avg_tokens_in": avg("tokens_in"),
        "avg_tokens_out": avg("tokens_out"),
        "avg_tokens_per_sec": avg("tokens_per_sec"),
        "errors": [r["error"] for r in all_runs if r.get("error")],
    }


def compute_stats(targets: list[dict]) -> list[dict]:
    """Метрики по всем моделям сессии — используется и отчётом судьи, и API
    (для отображения в UI без ожидания судьи), и PPTX-экспортом."""
    return [target_stats(t) for t in targets]


def _target_outputs_text(target: dict) -> str:
    lines = []
    for r in target.get("results", []):
        if r.get("error"):
            lines.append(f"Прогон {r['run']}: ОШИБКА — {r['error']}")
        else:
            lines.append(f"Прогон {r['run']} (саммари):\n{r['output_text']}")
    return "\n\n".join(lines)


def _judge_single_target(judge_provider: str, prompt: str, transcript: str, target: dict, stats: dict,
                          judge_instructions: str = "") -> str:
    """Оценка качества ОДНОЙ модели — отдельным независимым запросом.

    Раньше все модели и все прогоны склеивались в один гигантский промпт
    судье, и на 3+ моделях с несколькими прогонами это упиралось в лимит
    токенов контекста. Теперь каждая модель оценивается своим отдельным
    запросом ("с нуля", без накопленного контекста прошлых моделей) — размер
    промпта больше не растёт с числом тестируемых моделей.

    judge_instructions — доп. критерии оценки из выбранного сценария (см.
    db/model_bench_scenarios_store.py) — конкретика, что именно важно для
    ЭТОГО типа задачи (например, для саммаризации инцидентов: хронология,
    сохранность технических деталей и т.п.), поверх общих вопросов ниже."""
    extra_block = f"\n\nДОПОЛНИТЕЛЬНЫЕ КРИТЕРИИ ОЦЕНКИ (из сценария):\n{judge_instructions}\n" if judge_instructions.strip() else ""
    judge_prompt = (
        "Ты Senior QA-инженер, оцениваешь качество саммаризации транскрибации одной LLM-моделью.\n\n"
        "ИСХОДНЫЙ ПРОМПТ ДЛЯ САММАРИЗАЦИИ (что просили у модели):\n" + prompt + "\n\n"
        "ИСХОДНАЯ ТРАНСКРИБАЦИЯ:\n" + transcript[:6000] + "\n\n"
        f"ОЦЕНИВАЕМАЯ МОДЕЛЬ: {target.get('provider')}/{target.get('model')}\n"
        f"Технические метрики (уже измерены, не пересчитывай): среднее время {stats['avg_latency_sec']}с, "
        f"~{stats['avg_tokens_per_sec']} ток/сек, {stats['runs_ok']}/{stats['runs_total']} успешных прогонов.\n\n"
        "ОТВЕТЫ МОДЕЛИ ПО ПРОГОНАМ:\n" + (_target_outputs_text(target) or "(нет успешных прогонов)") + "\n\n"
        "Кратко (5-8 предложений) оцени: точность (нет ли искажений фактов из транскрибации), "
        "полноту (не потеряны ли важные детали), галлюцинации (придуманные факты, которых не было "
        "в транскрибации), стабильность формата/длины между прогонами. Без вводных фраз, сразу к делу."
        + extra_block
    )
    client = LLMClient(provider=judge_provider, timeout=_BENCH_TIMEOUT_SEC)
    resp = client.chat_continued(
        [Message(role="user", content=judge_prompt)], temperature=0.3, max_tokens=1200,
        continuation_instruction=(
            "Продолжи оценку точно с того места, где текст оборвался. "
            "НЕ повторяй уже написанное — только продолжение."
        ),
    )
    return resp.content.strip()


def analyze_report(judge_provider: str, prompt: str, transcript: str, targets: list[dict],
                    judge_instructions: str = "") -> tuple[str, dict | None]:
    """Сравнительный отчёт по всем накопленным моделям/прогонам.

    Двухфазная схема специально ради лимита токенов:
    1) каждая модель оценивается ОТДЕЛЬНЫМ независимым запросом судье
       (см. _judge_single_target) — промпт не растёт с числом моделей;
    2) финальный запрос сравнивает модели по уже готовым (коротким)
       оценкам и посчитанным в коде метрикам, а не по сырым ответам —
       он всегда компактный, вне зависимости от того, сколько было
       моделей и прогонов.

    Технические метрики (латентность, ток/сек) считаем в коде и просто
    передаём судье как факт — судья оценивает только КАЧЕСТВО саммари.

    Судья — модель, выбранная пользователем для всей платформы (глобальный
    провайдер), НЕ одна из тестируемых моделей и без переопределения модели —
    поэтому вызывается без model-override, чат берёт дефолтную модель провайдера.

    Возвращает (текст_отчёта, лучшая_модель | None), где лучшая_модель —
    {"provider": ..., "model": ...}, если судья её явно назвала и она
    действительно есть среди протестированных (не выдумана)."""
    stats = compute_stats(targets)

    assessments = [
        _judge_single_target(judge_provider, prompt, transcript, t, s, judge_instructions)
        for t, s in zip(targets, stats)
    ]

    summary_block = "\n\n".join(
        f"### {s['provider']}/{s['model']}\n"
        f"Метрики: среднее время {s['avg_latency_sec']}с (мин {s['min_latency_sec']}с / "
        f"медиана {s['median_latency_sec']}с / макс {s['max_latency_sec']}с), "
        f"~{s['avg_tokens_per_sec']} ток/сек, контекст ~{s['avg_tokens_in']} → ответ ~{s['avg_tokens_out']} токенов, "
        f"успешность {s['success_rate']}% ({s['runs_ok']}/{s['runs_total']} прогонов)"
        + (f", ошибки: {'; '.join(s['errors'][:3])}" if s["errors"] else "") + ".\n"
        f"Оценка качества саммари: {assessment}"
        for s, assessment in zip(stats, assessments)
    )

    judge_extra = f"\n\nДОПОЛНИТЕЛЬНЫЕ КРИТЕРИИ ОЦЕНКИ (из сценария, учти их при сравнении):\n{judge_instructions}\n" if judge_instructions.strip() else ""
    final_prompt = (
        "Ниже — оценки качества саммаризации по нескольким LLM-моделям, полученные отдельно для "
        "каждой модели, плюс их технические метрики (не пересчитывай, используй как факт)."
        + judge_extra + "\n\n"
        + summary_block + "\n\n"
        "На основе этого напиши ДЕТАЛЬНЫЙ сравнительный отчёт в Markdown:\n"
        "1. Таблица: Модель | Сильные стороны | Слабые стороны | Стабильность между прогонами (разброс "
        "времени мин/медиана/макс, успешность)\n"
        "2. По каждой модели отдельным подразделом: риски применения в проде (галлюцинации, обрывы "
        "по лимиту токенов, нестабильность, ошибки) — только если они реально были видны в оценке или метриках, "
        "не выдумывай.\n"
        "3. Итоговая рекомендация: какая модель лучше подходит для саммаризации звонков "
        "с учётом и качества, и скорости, и стабильности из метрик выше.\n"
        "Пиши по делу, без вводных фраз.\n\n"
        "ПОСЛЕДНЕЙ СТРОКОЙ ОБЯЗАТЕЛЬНО укажи победителя в точности таком формате "
        "(без пояснений после неё):\n"
        "ЛУЧШАЯ_МОДЕЛЬ: provider::model\n"
        "Где provider и model — ровно как в заголовках моделей выше "
        "(например: custom_groq::llama-3.3-70b-versatile)."
    )

    client = LLMClient(provider=judge_provider, timeout=_BENCH_TIMEOUT_SEC)
    # Обрыв перед строкой ЛУЧШАЯ_МОДЕЛЬ означал бы, что подсветка победителя тихо
    # пропадает — chat_continued гарантирует, что судья дойдёт до конца отчёта.
    resp = client.chat_continued(
        [Message(role="user", content=final_prompt)], temperature=0.3, max_tokens=3000,
        continuation_instruction=(
            "Продолжи отчёт точно с того места, где текст оборвался. НЕ повторяй уже "
            "написанное. Не забудь завершить строкой «ЛУЧШАЯ_МОДЕЛЬ: provider::model»."
        ),
    )
    report = resp.content.strip()

    best = None
    m = _BEST_MARKER_RE.search(report)
    if m:
        cand_provider, cand_model = m.group(1).strip(), m.group(2).strip()
        if any(t.get("provider") == cand_provider and t.get("model") == cand_model for t in targets):
            best = {"provider": cand_provider, "model": cand_model}
        report = report[:m.start()].rstrip()

    return report, best
