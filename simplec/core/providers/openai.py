from __future__ import annotations

from typing import Any, Dict

from .base import BaseProvider
from simplec.app.services.llm_openai import generate_zephyr_import_openai


class OpenAIProvider(BaseProvider):
    name = "openai"

    def generate_zephyr_import(self, normalized: Dict[str, Any], platform: str, feature: str) -> Dict[str, Any]:
        return generate_zephyr_import_openai(normalized, platform=platform, feature=feature)
