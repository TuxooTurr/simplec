"""
Безопасная конфигурация.
Загрузка секретов из переменных окружения или .env с валидацией.
"""

import os
import base64
import hashlib
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


class SecureConfig:

    @staticmethod
    def get_auth_key() -> str:
        key = os.getenv("GIGACHAT_AUTH_KEY", "")
        if not key:
            raise ValueError(
                "GIGACHAT_AUTH_KEY не задан. "
                "Установите через переменную окружения или .env"
            )
        if len(key) < 20:
            raise ValueError(
                "GIGACHAT_AUTH_KEY слишком короткий. "
                "Проверьте значение."
            )
        return key

    @staticmethod
    def get_scope() -> str:
        return os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")

    @staticmethod
    def get_model() -> str:
        return os.getenv("GIGACHAT_MODEL", "GigaChat")

    @staticmethod
    def validate_env():
        issues = []

        env_path = Path(".env")
        if env_path.exists():
            perms = oct(env_path.stat().st_mode)[-3:]
            if perms != "600":
                issues.append(
                    "WARNING: .env права доступа " + perms
                    + " (рекомендуется 600)"
                )

        key = os.getenv("GIGACHAT_AUTH_KEY", "")
        if not key:
            issues.append("CRITICAL: GIGACHAT_AUTH_KEY не задан")
        elif len(key) < 20:
            issues.append("CRITICAL: GIGACHAT_AUTH_KEY слишком короткий")

        return issues

    @staticmethod
    def key_fingerprint() -> str:
        key = os.getenv("GIGACHAT_AUTH_KEY", "")
        if not key:
            return "NOT_SET"
        h = hashlib.sha256(key.encode()).hexdigest()[:12]
        return h


