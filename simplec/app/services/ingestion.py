from __future__ import annotations

from pathlib import Path


def ingest_from_text(text: str) -> str:
    return (text or "").strip()


def ingest_from_file(path: str) -> str:
    """
    MVP MOCK: не читаем файл с диска.
    Возвращаем требования по "ключам" в имени файла.
    """
    p = Path(path)
    key = (p.name or "").lower()

    if "empty" in key:
        return ""

    if "auth" in key:
        return "\n".join(
            [
                "Пользователь должен иметь возможность войти по email и паролю.",
                "При неверном пароле система должна показать сообщение об ошибке.",
                "После 5 неудачных попыток аккаунт должен быть заблокирован на 15 минут.",
            ]
        )

    # дефолтный мок
    return "\n".join(
        [
            "Пользователь должен иметь возможность загрузить файл требований.",
            "Система должна сгенерировать набор тест-кейсов.",
        ]
    )
