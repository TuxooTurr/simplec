"""Add missing JSON records without replacing current values."""
from __future__ import annotations
from copy import deepcopy
import json
from typing import Any


def item_key(value: Any):
    if isinstance(value, dict):
        for key in ('id', 'key', 'name'):
            if isinstance(value.get(key), (str, int)) and value[key] != '':
                return key, str(value[key])
    return None


def merge_missing(current: Any, incoming: Any, *, merge_lists: bool = True) -> Any:
    if isinstance(current, dict) and isinstance(incoming, dict):
        result = deepcopy(current)
        for key, value in incoming.items():
            if key not in result:
                result[key] = deepcopy(value)
            elif key == 'nextKey' and isinstance(result[key], int) and isinstance(value, int):
                result[key] = max(result[key], value)
            else:
                result[key] = merge_missing(result[key], value, merge_lists=merge_lists)
        return result
    if isinstance(current, list) and isinstance(incoming, list):
        if not merge_lists: return deepcopy(current)
        result = deepcopy(current)
        positions = {identity: i for i, value in enumerate(result) if (identity := item_key(value)) is not None}
        seen = {json.dumps(value, sort_keys=True, ensure_ascii=False) for value in current}
        for value in incoming:
            identity = item_key(value)
            if identity is not None and identity in positions:
                at = positions[identity]
                result[at] = merge_missing(result[at], value, merge_lists=merge_lists)
            elif json.dumps(value, sort_keys=True, ensure_ascii=False) not in seen:
                if identity is not None: positions[identity] = len(result)
                result.append(deepcopy(value))
                seen.add(json.dumps(value, sort_keys=True, ensure_ascii=False))
        return result
    return deepcopy(current)
