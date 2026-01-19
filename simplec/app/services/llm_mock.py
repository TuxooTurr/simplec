from __future__ import annotations

import re
from typing import Dict, Any, List

from simplec.app.services.template_config import load_manual_template


def _validate_platform_feature(platform: str, feature: str) -> None:
    tpl = load_manual_template()
    if platform not in tpl.naming.platform_allowed:
        raise ValueError(f"platform должен быть одним из {tpl.naming.platform_allowed}, получено: {platform}")
    if not re.match(tpl.naming.feature_code_pattern, feature or ""):
        raise ValueError(f"feature должен соответствовать {tpl.naming.feature_code_pattern}, получено: {feature}")


def _make_name(platform: str, feature: str, title: str) -> str:
    tpl = load_manual_template()
    return tpl.naming.name_format.format(platform=platform, feature=feature, title=title).strip()


def _join_expected(expected_by_layer: Dict[str, str]) -> str:
    tpl = load_manual_template()
    parts: List[str] = []
    for layer in tpl.step_rules.expected_layers:
        val = (expected_by_layer.get(layer) or "N/A").strip()
        parts.append(f"{layer}: {val}")
    return tpl.step_rules.expected_joiner.join(parts).strip()


def _render_manual_md(cases: List[Dict[str, Any]]) -> str:
    tpl = load_manual_template()
    lines: List[str] = [tpl.md_header, ""]

    class _SafeDict(dict):
        def __missing__(self, key):
            return "N/A"

    for tc in cases:
        lines.append(tpl.md_case_title.format(name=tc["name"]))

        ctx = {
            "priority": tc.get("priority", tpl.default_priority),
            "status": tc.get("status", tpl.status.fixed),
            "trace": tc.get("trace", ""),
        }
        for b in tpl.md_bullets:
            lines.append(b.format_map(_SafeDict(ctx)))
        lines.append("")

        lines.append(tpl.md_sections.get("description", "**Description:**"))
        lines.append(tc.get("description", "").strip() or "(нет)")
        lines.append("")

        lines.append(tpl.md_sections.get("preconditions", "**Preconditions:**"))
        pre = tc.get("preconditions", [])
        if pre:
            for p in pre:
                lines.append(f"- {p}")
        else:
            lines.append("- (нет)")
        lines.append("")

        lines.append(tpl.md_sections.get("steps", "**Steps (Zephyr):**"))
        steps = tc.get("steps", [])
        for i, st in enumerate(steps, start=1):
            lines.append(f"{i}) Action: {st.get('action','').strip()}")
            td = (st.get("test_data") or "").strip()
            lines.append(f"   Test Data: {td if td else '—'}")
            lines.append(f"   Expected Result: {st.get('expected','').strip()}")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def _to_zephyr_import_v1(cases: List[Dict[str, Any]], context: Dict[str, Any]) -> Dict[str, Any]:
    payload_cases: List[Dict[str, Any]] = []
    for tc in cases:
        steps_out: List[Dict[str, Any]] = []
        for st in tc.get("steps", []):
            steps_out.append(
                {
                    "action": st.get("action", ""),
                    "testData": st.get("test_data", "") or "",
                    "result": st.get("expected", ""),
                }
            )

        payload_cases.append(
            {
                "name": tc["name"],
                "description": tc.get("description", ""),
                "preconditions": "\n".join(tc.get("preconditions", [])),
                "status": tc.get("status", "требуется согласование"),
                "priority": tc.get("priority", "P2"),
                "labels": tc.get("tags", []),
                "customFields": {
                    "trace": tc.get("trace", ""),
                    "platform": context.get("platform", ""),
                    "feature": context.get("feature", ""),
                },
                "steps": steps_out,
            }
        )

    return {
        "schema": "simplec.zephyr_import.v1",
        "context": context,
        "testCases": payload_cases,
    }


def generate_manual_tests_mock(normalized: Dict[str, Any], platform: str, feature: str) -> Dict[str, Any]:
    _validate_platform_feature(platform, feature)
    tpl = load_manual_template()

    items: List[Dict[str, Any]] = normalized.get("items", [])
    req_ids = [it.get("id", "") for it in items if it.get("id")]
    trace_default = req_ids[0] if req_ids else "N/A"

    context = {"platform": platform, "feature": feature}

    cases: List[Dict[str, Any]] = [
        {
            "name": _make_name(platform, feature, "Успешный вход по email/паролю"),
            "priority": "P1",
            "status": tpl.status.fixed,
            "trace": trace_default,
            "tags": ["smoke", "regression"],
            "description": "Проверить, что пользователь может авторизоваться по email/паролю и получить активную сессию.",
            "preconditions": [
                "Окружение: STAGE",
                "Пользователь test_user существует и активен",
            ],
            "steps": [
                {
                    "action": "Открыть страницу логина → ввести email и пароль → нажать «Войти».",
                    "test_data": "email=test_user@example.com; password=CorrectPassword1",
                    "expected": _join_expected(
                        {
                            "UI": "Пользователь попадает в личный кабинет, отображается имя/аватар.",
                            "API": "POST /login возвращает 200 и accessToken.",
                            "DB": "Создана/обновлена запись сессии для пользователя.",
                            "Kafka": "Опубликовано событие UserLoggedIn в auth.events.",
                        }
                    ),
                }
            ],
        },
        {
            "name": _make_name(platform, feature, "Вход с неверным паролем: ошибка"),
            "priority": "P1",
            "status": tpl.status.fixed,
            "trace": trace_default,
            "tags": ["regression"],
            "description": "Проверить, что при неверном пароле пользователь не авторизуется и видит корректную ошибку.",
            "preconditions": [
                "Окружение: STAGE",
                "Пользователь test_user существует и активен",
            ],
            "steps": [
                {
                    "action": "Открыть страницу логина → ввести email и неверный пароль → нажать «Войти».",
                    "test_data": "email=test_user@example.com; password=WrongPassword1",
                    "expected": _join_expected(
                        {
                            "UI": "Отображается сообщение «Неверный логин или пароль», пользователь остаётся на странице логина.",
                            "API": "POST /login возвращает 401/403 (по контракту), токен не выдаётся.",
                            "DB": "Сессия не создаётся; счётчик неуспешных попыток увеличен (если предусмотрено).",
                            "Kafka": "N/A",
                        }
                    ),
                }
            ],
        },
        {
            "name": _make_name(platform, feature, "Блокировка после 5 неудачных попыток"),
            "priority": "P0",
            "status": tpl.status.fixed,
            "trace": trace_default,
            "tags": ["regression"],
            "description": "Проверить, что после 5 подряд неуспешных попыток входа аккаунт блокируется на заданное время.",
            "preconditions": [
                "Окружение: STAGE",
                "Пользователь test_user существует и активен",
                "Сброшен счётчик неуспешных попыток входа (если хранится)",
            ],
            "steps": [
                {
                    "action": "5 раз подряд выполнить вход с неверным паролем для test_user.",
                    "test_data": "email=test_user@example.com; password=WrongPassword1",
                    "expected": _join_expected(
                        {
                            "UI": "На 5-й попытке/после неё отображается сообщение о блокировке; вход невозможен.",
                            "API": "POST /login возвращает ошибку блокировки (например 423 Locked/403) с признаком lock.",
                            "DB": "Зафиксировано состояние блокировки и время окончания блокировки.",
                            "Kafka": "N/A",
                        }
                    ),
                },
                {
                    "action": "Попытаться войти с корректным паролем до истечения блокировки.",
                    "test_data": "email=test_user@example.com; password=CorrectPassword1",
                    "expected": _join_expected(
                        {
                            "UI": "Пользователь не входит, видит сообщение о блокировке.",
                            "API": "POST /login возвращает ошибку блокировки (423/403).",
                            "DB": "Сессия не создаётся.",
                            "Kafka": "N/A",
                        }
                    ),
                },
            ],
        },
    ]

    report = {
        "context": context,
        "requirements_total": len(req_ids),
        "requirements_covered": min(len(cases), len(req_ids)) if req_ids else 0,
        "coverage_ratio": (min(len(cases), len(req_ids)) / len(req_ids)) if req_ids else 0.0,
        "uncovered_reqs": req_ids[min(len(cases), len(req_ids)) :] if req_ids else [],
        "template_used": "simplec/config/test_template.yaml",
    }

    manual_md = _render_manual_md(cases)
    zephyr_import = _to_zephyr_import_v1(cases, context)

    return {"manual_tests_md": manual_md, "report": report, "zephyr_import": zephyr_import}
