"""Pixso MCP credentials for the current Shark account."""
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.api.auth import require_user
from backend.api.jira_defects import _get, _set
from db.postgres import SessionLocal
from webconnect.secrets import SecretError, decrypt, encrypt

router = APIRouter(prefix="/api/settings/pixso")


def load_token(login: str) -> str:
    with SessionLocal() as db:
        value = _get(db, f"pixso_token:{login}") if login else ""
    return decrypt(value) if value else os.getenv("PIXSO_TOKEN", "").strip()


class Settings(BaseModel):
    token: str = Field(max_length=4096, pattern=r"^[^\r\n]*$")


@router.get("")
def status(user=Depends(require_user)):
    try:
        return {"configured": bool(load_token(user["login"]))}
    except SecretError:
        return {"configured": False}


@router.put("")
def save(body: Settings, user=Depends(require_user)):
    token = body.token.strip()
    try:
        with SessionLocal() as db:
            _set(db, f"pixso_token:{user['login']}", encrypt(token) if token else "", "Pixso MCP")
            db.commit()
    except SecretError:
        raise HTTPException(503, "Защищённое хранилище Shark недоступно.") from None
    return status(user)
