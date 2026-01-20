from __future__ import annotations

from typing import Any, Dict

from .base import BaseProvider
from simplec.app.services.llm_gigachat import generate_zephyr_import_gigachat


class GigaChatProvider(BaseProvider):
    name = "gigachat"

    def generate_zephyr_import(self, normalized: Dict[str, Any], platform: str, feature: str) -> Dict[str, Any]:
        return generate_zephyr_import_gigachat(normalized, platform=platform, feature=feature)
