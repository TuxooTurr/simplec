from __future__ import annotations

from typing import Any, Dict


class BaseProvider:
    name: str = "base"

    def generate_zephyr_import(self, normalized: Dict[str, Any], platform: str, feature: str) -> Dict[str, Any]:
        raise NotImplementedError


def get_provider(name: str, use_real: bool) -> BaseProvider:
    name = (name or "gigachat").lower().strip()
    if not use_real or name == "mock":
        from .mock import MockProvider
        return MockProvider()
    if name == "openai":
        from .openai import OpenAIProvider
        return OpenAIProvider()
    if name == "gigachat":
        from .gigachat import GigaChatProvider
        return GigaChatProvider()
    raise ValueError(f"Unknown LLM provider: {name}")
