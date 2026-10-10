"""
Оформление плиток хаба «Генераторы событий»: название, подсказка, иконка, цвет.

Ключ плитки — id сценария («metrics», «jobs», …) или «alerts:<id папки>».
Хранится только то, что изменили; пустое поле — стандартное значение из кода.
Общее на всю команду: все видят одинаковые плитки.

Файл: data/hub_tiles.json
"""

import json
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_FILE = _ROOT / "data" / "hub_tiles.json"

FIELDS = ("title", "subtitle", "icon", "color")


class HubTilesStore:

    @staticmethod
    def _load() -> dict[str, dict]:
        if not _FILE.exists():
            return {}
        with open(_FILE, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _save(tiles: dict[str, dict]) -> None:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_FILE, "w", encoding="utf-8") as f:
            json.dump(tiles, f, ensure_ascii=False, indent=2)

    @classmethod
    def all(cls) -> dict[str, dict]:
        return cls._load()

    @classmethod
    def save(cls, key: str, values: dict) -> dict:
        """Сохраняет оформление; пустые поля не хранятся. Ничего не осталось — запись удаляется."""
        tiles = cls._load()
        clean = {k: v.strip() for k in FIELDS if isinstance(v := values.get(k), str) and v.strip()}
        if clean:
            tiles[key] = clean
        else:
            tiles.pop(key, None)
        cls._save(tiles)
        return clean

    @classmethod
    def reset(cls, key: str) -> None:
        tiles = cls._load()
        if tiles.pop(key, None) is not None:
            cls._save(tiles)
