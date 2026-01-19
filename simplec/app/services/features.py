from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Dict, Optional


FEATURES_PATH_DEFAULT = "simplec/config/features.json"


@dataclass
class Feature:
    code: str
    name: str


def _load(path: str) -> Dict[str, str]:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items()}


def _save(path: str, data: Dict[str, str]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def register_feature(code: str, name: str, path: str = FEATURES_PATH_DEFAULT) -> None:
    data = _load(path)
    data[code] = name
    _save(path, data)


def resolve_feature_name(code: str, path: str = FEATURES_PATH_DEFAULT) -> Optional[str]:
    data = _load(path)
    return data.get(code)
