from __future__ import annotations

from typing import Any, Dict

from .base import BaseProvider
from simplec.app.services.llm_mock import generate_manual_tests_mock


class MockProvider(BaseProvider):
    name = "mock"

    def generate_zephyr_import(self, normalized: Dict[str, Any], platform: str, feature: str) -> Dict[str, Any]:
        out = generate_manual_tests_mock(normalized, platform=platform, feature=feature)
        return out.get("zephyr_import") or {
            "schema": "simplec.zephyr_import.v1",
            "context": {"platform": platform, "feature": feature},
            "testCases": [],
        }
