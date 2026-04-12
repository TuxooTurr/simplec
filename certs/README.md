# certs — корпоративные SSL-сертификаты

## Проблема

В корпоративной сети Сбера HTTPS-трафик проходит через TLS-инспекцию (BIG IP proxy),
который подменяет оригинальные сертификаты серверов на свои:

```
issuer: CN=BIG IP; O=Sberbank of Russia; OU=Department Cyber Security
```

Python использует свой OpenSSL + certifi bundle, в котором корпоративных CA нет.
Результат: `SSL: CERTIFICATE_VERIFY_FAILED` при вызовах DeepSeek, OpenAI и т.д.

## Решение

Скрипт `build_bundle.sh` собирает объединённый bundle:

```
certifi/cacert.pem + корпоративные CA из macOS Keychain = ca-bundle.pem
```

Backend автоматически использует `ca-bundle.pem` при старте (через `SSL_CERT_FILE`).

## Установка

```bash
# Убедитесь что .venv активирован
source .venv/bin/activate

# Соберите bundle (нужен macOS с корп. CA в Keychain)
bash certs/build_bundle.sh

# Перезапустите backend
# uvicorn backend.main:app --reload --port 8000
```

## Обновление

Пересобирайте bundle после:
- `pip install --upgrade certifi`
- Смены корпоративных сертификатов IT-отделом

## Файлы

| Файл | Описание |
|------|----------|
| `build_bundle.sh` | Скрипт сборки bundle |
| `ca-bundle.pem` | Готовый bundle (генерируется, **не в git**) |

## Без корпоративной сети

Если `ca-bundle.pem` отсутствует — backend использует стандартный certifi.
Ничего дополнительно делать не нужно.
