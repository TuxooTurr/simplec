"""Цвет микросервиса на странице стенда (backend/ms_color.py) — тот же, что во фронте (frontend/lib/msColor.ts)."""

import pytest

from backend.ms_color import ms_group, ms_hex, ms_tone

# Эталон — msTone из frontend/lib/msColor.ts (сверено на всём справочнике из 395 микросервисов).
@pytest.mark.parametrize("name, tone", [
    ("work-group-ms", ("work", 134, 1)), ("work-group-web-api-gate", ("work", 134, 2)),
    ("routine-work-ms", ("routine", 215, 0)), ("pkap-work-group-ms", ("pkap", 215, 1)),
    ("sber911-chat-message-ms", ("chat", 326, 1)), ("CI02484989_asds_CD", ("asds", 309, 0)),
    ("api-health-check-mcp-ms", ("health", 101, 3)),
])
def test_тон_как_во_фронте(name, tone):
    assert ms_tone(name) == tone


def test_группа_и_цвет():
    assert ms_group("sber911-front") == "sber911"           # одни служебные слова — первое слово
    assert ms_hex("work-group-ms").startswith("#") and len(ms_hex("work-group-ms")) == 7
