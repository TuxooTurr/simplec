"""
Оформление плиток «Генераторов событий» (db/hub_tiles_store.py).

Читают все, меняет только суперюзер. Иконка — «lucide:<Имя>» (библиотека Lucide)
или «emoji:<символ>»; цвет — ключ палитры на фронте (frontend/lib/tileStyle.ts).
"""

import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from db.hub_tiles_store import HubTilesStore

router = APIRouter()

KEY_RE = re.compile(r"^(alerts:)?[A-Za-z0-9_-]{1,64}$")
ICON_RE = re.compile(r"^(lucide:[A-Z][A-Za-z0-9]{1,63}|emoji:.{1,16})$")
COLOR_RE = re.compile(r"^[a-z]{3,16}$")


def _require_superuser(request: Request) -> None:
    user = getattr(request.state, "user", None)
    if user and user.get("role") != "superuser":
        raise HTTPException(403, "Оформление плиток меняет только суперюзер")


def _check_key(key: str) -> None:
    if not KEY_RE.match(key):
        raise HTTPException(422, "Неизвестная плитка")


class TileBody(BaseModel):
    title:    Optional[str] = Field(default=None, max_length=80)
    subtitle: Optional[str] = Field(default=None, max_length=300)
    icon:     Optional[str] = None
    color:    Optional[str] = None

    @field_validator("icon")
    @classmethod
    def _icon(cls, v: Optional[str]) -> Optional[str]:
        if v and not ICON_RE.match(v):
            raise ValueError("Иконка: lucide:<Имя> или emoji:<символ>")
        return v

    @field_validator("color")
    @classmethod
    def _color(cls, v: Optional[str]) -> Optional[str]:
        if v and not COLOR_RE.match(v):
            raise ValueError("Неизвестный цвет")
        return v


@router.get("/api/hub/tiles")
def list_tiles() -> dict:
    return HubTilesStore.all()


@router.put("/api/hub/tiles/{key}")
def save_tile(key: str, body: TileBody, request: Request) -> dict:
    _require_superuser(request)
    _check_key(key)
    return HubTilesStore.save(key, body.model_dump())


@router.delete("/api/hub/tiles/{key}")
def reset_tile(key: str, request: Request) -> dict:
    _require_superuser(request)
    _check_key(key)
    HubTilesStore.reset(key)
    return {"status": "reset"}
