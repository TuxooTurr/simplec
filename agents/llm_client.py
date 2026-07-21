"""
Универсальный LLM клиент.

Встроенный провайдер: GigaChat.
Остальные (DeepSeek, OpenAI, Gemini, Ollama и т.д.) подключаются пользователем
в настройках как chat/completions-compatible endpoint через API key или
TLS/client certificate.
"""

import base64
import json
import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import List


logger = logging.getLogger(__name__)


# Кэш распакованных PEM: (путь+mtime) -> временный .pem файл
_PEM_CACHE: dict[str, str] = {}


def _gigachat_no_verify() -> bool:
    """Отключена ли проверка серверного сертификата для GigaChat.

    Учитываем и глобальный SSL_NO_VERIFY (общий для всех провайдеров), и
    gigachat-scoped GIGACHAT_NO_VERIFY (сохраняется из формы настроек GigaChat).
    Так «Загрузить модели», «Тест чата» и рабочий чат используют один флаг."""
    for name in ("SSL_NO_VERIFY", "GIGACHAT_NO_VERIFY"):
        if os.environ.get(name, "").lower() in ("1", "true", "yes"):
            return True
    return False


def _resolve_pem_path(path: str) -> str:
    """Возвращает путь к нормальному PEM-файлу.

    Сертификаты СберCA часто выгружаются как .txt, где содержимое — PEM, ещё раз
    завёрнутый в Base64 (одна длинная строка). Такой файл SSL не примет.
    Здесь: если файл уже PEM (`-----BEGIN`), возвращаем как есть; если это
    Base64-обёртка над PEM — декодируем во временный .pem (0600) и отдаём его путь.
    Иначе возвращаем исходный путь (пусть SSL сам ругнётся)."""
    if not path:
        return path
    p = Path(path)
    if not p.is_file():
        return path
    try:
        raw = p.read_bytes()
    except Exception:
        return path
    if b"-----BEGIN" in raw:
        return path  # уже нормальный PEM
    try:
        decoded = base64.b64decode("".join(raw.decode("utf-8", "ignore").split()), validate=True)
    except Exception:
        return path
    if b"-----BEGIN" not in decoded:
        return path

    key = f"{p.resolve()}::{p.stat().st_mtime_ns}"
    cached = _PEM_CACHE.get(key)
    if cached and os.path.exists(cached):
        return cached
    fd, tmp = tempfile.mkstemp(prefix="st_pem_", suffix=".pem")  # mkstemp -> права 0600
    with os.fdopen(fd, "wb") as f:
        f.write(decoded)
    _PEM_CACHE[key] = tmp
    return tmp


def _get_verify():
    """Возвращает SSL verify параметр для httpx (False / path / SSLContext).

    Порядок приоритетов:
    1. SSL_NO_VERIFY=1   -> verify=False (быстрый обход для корпоративного прокси)
    2. certs/ca-bundle.pem / SSL_CERT_FILE -> SSLContext с корпоративным CA
    3. По умолчанию -> SSLContext с certifi + флаги совместимости
    """
    if os.environ.get("SSL_NO_VERIFY", "").lower() in ("1", "true", "yes"):
        return False

    import ssl

    ca = os.environ.get("SSL_CERT_FILE")
    cafile = ca if (ca and os.path.exists(ca)) else None

    try:
        import certifi
        ctx = ssl.create_default_context(cafile=cafile or certifi.where())
    except Exception:
        return cafile or True

    if hasattr(ssl, "OP_LEGACY_SERVER_CONNECT"):
        ctx.options |= ssl.OP_LEGACY_SERVER_CONNECT

    if os.environ.get("SSL_MAX_TLS12", "").lower() in ("1", "true", "yes"):
        try:
            ctx.maximum_version = ssl.TLSVersion.TLSv1_2
        except AttributeError:
            pass

    return ctx


def _load_custom_providers() -> list[dict]:
    """Custom LLM providers from CUSTOM_LLM_PROVIDERS JSON env."""
    raw = os.getenv("CUSTOM_LLM_PROVIDERS", "[]")
    try:
        data = json.loads(raw)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    result: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        provider_id = str(item.get("id", "")).strip().lower()
        if not provider_id.startswith("custom_"):
            continue
        result.append(item)
    return result


def _get_custom_provider(provider_id: str) -> dict | None:
    provider_id = provider_id.lower()
    for cfg in _load_custom_providers():
        if str(cfg.get("id", "")).lower() == provider_id:
            return cfg
    return None


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def _auth_type(prefix: str) -> str:
    value = _env(prefix + "_AUTH_TYPE", "api_key").lower()
    if value not in ("api_key", "certificate"):
        raise ValueError(prefix + "_AUTH_TYPE must be api_key or certificate")
    return value


def _gigachat_ssl_context(ca_cert: str, no_verify: bool):
    """SSLContext для GigaChat SDK с потолком TLS 1.2 — лечит 'Connection reset by
    peer' от старых BIG IP, которые не умеют TLS 1.3 и рвут рукопожатие."""
    import ssl

    try:
        import certifi
        ctx = ssl.create_default_context(cafile=ca_cert or certifi.where())
    except Exception:
        ctx = ssl.create_default_context()

    if no_verify and not ca_cert:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    if hasattr(ssl, "OP_LEGACY_SERVER_CONNECT"):
        ctx.options |= ssl.OP_LEGACY_SERVER_CONNECT
    try:
        ctx.maximum_version = ssl.TLSVersion.TLSv1_2
    except AttributeError:
        pass
    return ctx


def _gigachat_tls_kwargs() -> dict:
    """Translate shared env/cert settings into kwargs accepted by gigachat SDK."""
    kwargs: dict = {}
    explicit_ca = _env("GIGACHAT_CA_CERT_PATH")
    global_ca = _env("SSL_CERT_FILE")
    ca_cert = explicit_ca or (global_ca if global_ca and os.path.exists(global_ca) else "")
    no_verify = os.environ.get("SSL_NO_VERIFY", "").lower() in ("1", "true", "yes")

    if os.environ.get("SSL_MAX_TLS12", "").lower() in ("1", "true", "yes"):
        # Явный SSLContext доходит и до auth-, и до chat-клиента GigaChat SDK
        # (verify_ssl_certs/ca_bundle_file при заданном ssl_context игнорируются).
        kwargs["ssl_context"] = _gigachat_ssl_context(ca_cert, no_verify)
    elif ca_cert:
        kwargs["ca_bundle_file"] = ca_cert
        kwargs["verify_ssl_certs"] = True
    else:
        # Preserve the previous project behavior for GigaChat: local/corp setups
        # often rely on disabled verification unless a CA bundle is configured.
        kwargs["verify_ssl_certs"] = False

    cert_file = _env("GIGACHAT_CLIENT_CERT_PATH")
    key_file = _env("GIGACHAT_CLIENT_KEY_PATH")
    if cert_file:
        kwargs["cert_file"] = cert_file
    if key_file:
        kwargs["key_file"] = key_file
    return kwargs


def list_gigachat_models(
    base_url: str = "",
    auth_type: str = "",
    client_cert_path: str = "",
    client_key_path: str = "",
    ca_cert_path: str = "",
    no_verify: bool | None = None,
) -> list[str]:
    """Список моделей стенда GigaChat (`GET {base_url}/models`). Пустые аргументы
    берутся из сохранённых настроек (env). Для cert-режима — прямой httpx (mTLS),
    для api_key — OAuth-токен через SDK. Возвращает id моделей, отсортированные."""
    import httpx

    base_url = (base_url or _env("GIGACHAT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1")).rstrip("/")
    auth_type = (auth_type or _env("GIGACHAT_AUTH_TYPE", "api_key")).lower()
    ca = ca_cert_path or _env("GIGACHAT_CA_CERT_PATH")
    if no_verify is None:
        no_verify = _gigachat_no_verify()

    logger.info("GigaChat /models: base_url=%s auth_type=%s no_verify=%s", base_url, auth_type, no_verify)

    def _extract(data) -> list[str]:
        items = data.get("data", data) if isinstance(data, dict) else data
        out = [str(m.get("id")) for m in items if isinstance(m, dict) and m.get("id")]
        return sorted(set(out))

    if auth_type == "certificate":
        cert_file = client_cert_path or _env("GIGACHAT_CLIENT_CERT_PATH")
        key_file = client_key_path or _env("GIGACHAT_CLIENT_KEY_PATH")
        if not cert_file:
            raise ValueError("Не указан путь к клиентскому сертификату")
        cert_file = _resolve_pem_path(cert_file)
        key_file = _resolve_pem_path(key_file)
        verify = False if no_verify else (_resolve_pem_path(ca) if ca else _get_verify())
        cert = (cert_file, key_file) if key_file else cert_file
        with httpx.Client(timeout=30.0, verify=verify, cert=cert) as c:
            r = c.get(base_url + "/models", headers={"Content-Type": "application/json"})
            r.raise_for_status()
            return _extract(r.json())

    # api_key: получить токен через SDK и дёрнуть список моделей
    from gigachat import GigaChat
    credentials = _env("GIGACHAT_AUTH_KEY") or _env("GIGACHAT_CREDENTIALS")
    if not credentials:
        raise ValueError("Не задан GIGACHAT_AUTH_KEY")
    g = GigaChat(
        credentials=credentials,
        scope=_env("GIGACHAT_SCOPE", "GIGACHAT_API_PERS") or "GIGACHAT_API_PERS",
        base_url=base_url,
        **_gigachat_tls_kwargs(),
    )
    models = g.get_models()
    return sorted({str(getattr(m, "id_", getattr(m, "id", ""))) for m in models.data if getattr(m, "id_", getattr(m, "id", ""))})


def probe_gigachat_chat(
    model: str,
    base_url: str = "",
    auth_type: str = "",
    client_cert_path: str = "",
    client_key_path: str = "",
    ca_cert_path: str = "",
    no_verify: bool | None = None,
    prompt: str = "ping",
) -> str:
    """Пробный чат к стенду GigaChat теми же параметрами, что и «Загрузить модели».

    Используется кнопкой «Тест чата» до сохранения настроек: источник — живая форма,
    а не os.environ. Возвращает текст ответа модели (или бросает исключение).
    Пустые аргументы берутся из сохранённых настроек (env)."""
    import httpx

    base_url = (base_url or _env("GIGACHAT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1")).rstrip("/")
    auth_type = (auth_type or _env("GIGACHAT_AUTH_TYPE", "api_key")).lower()
    model = (model or _env("GIGACHAT_MODEL", "GigaChat")).strip()
    if not base_url:
        raise ValueError("Не указан base_url стенда")
    if not model:
        raise ValueError("Не выбрана модель")
    if no_verify is None:
        no_verify = _gigachat_no_verify()

    logger.info("GigaChat test-chat: base_url=%s model=%s auth_type=%s no_verify=%s",
                base_url, model, auth_type, no_verify)

    payload = {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 8}

    if auth_type == "certificate":
        cert_file = client_cert_path or _env("GIGACHAT_CLIENT_CERT_PATH")
        key_file = client_key_path or _env("GIGACHAT_CLIENT_KEY_PATH")
        if not cert_file:
            raise ValueError("Не указан путь к клиентскому сертификату")
        cert_file = _resolve_pem_path(cert_file)
        key_file = _resolve_pem_path(key_file)
        ca = ca_cert_path or _env("GIGACHAT_CA_CERT_PATH")
        verify = False if no_verify else (_resolve_pem_path(ca) if ca else _get_verify())
        cert = (cert_file, key_file) if key_file else cert_file
        with httpx.Client(timeout=60.0, verify=verify, cert=cert) as c:
            r = c.post(base_url + "/chat/completions", json=payload,
                       headers={"Content-Type": "application/json"})
            r.raise_for_status()
            data = r.json()
        return str(data["choices"][0]["message"]["content"])

    # api_key: через SDK (OAuth-токен), модель из формы.
    from gigachat import GigaChat
    from gigachat.models import Chat, Messages
    credentials = _env("GIGACHAT_AUTH_KEY") or _env("GIGACHAT_CREDENTIALS")
    if not credentials:
        raise ValueError("Не задан GIGACHAT_AUTH_KEY")
    g = GigaChat(
        credentials=credentials,
        scope=_env("GIGACHAT_SCOPE", "GIGACHAT_API_PERS") or "GIGACHAT_API_PERS",
        base_url=base_url,
        model=model,
        **_gigachat_tls_kwargs(),
    )
    resp = g.chat(Chat(model=model, messages=[Messages(role="user", content=prompt)], max_tokens=8))
    return str(resp.choices[0].message.content)


def _builtin_status(provider_id: str) -> dict:
    """Return readiness without making a network request."""
    if provider_id == "gigachat":
        try:
            auth = _auth_type("GIGACHAT")
        except ValueError as e:
            return {"id": "gigachat", "name": "GigaChat", "status": "no_key", "message": str(e)}
        base_url = _env("GIGACHAT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1")
        model = _env("GIGACHAT_MODEL", "GigaChat")
        credentials = _env("GIGACHAT_AUTH_KEY") or _env("GIGACHAT_CREDENTIALS")
        cert_file = _env("GIGACHAT_CLIENT_CERT_PATH")
        missing = []
        if not base_url:
            missing.append("URL")
        if not model:
            missing.append("модель")
        if auth == "api_key" and not credentials:
            missing.append("GIGACHAT_AUTH_KEY")
        if auth == "certificate" and not cert_file:
            missing.append("клиентский сертификат")
        return {
            "id": "gigachat",
            "name": "GigaChat",
            "status": "ready" if not missing else "no_key",
            "message": "OK" if not missing else "Не настроено: " + ", ".join(missing),
        }

    return {"id": provider_id, "name": provider_id, "status": "no_key", "message": "Неизвестный провайдер"}


@dataclass
class Message:
    role: str
    content: str


@dataclass
class LLMResponse:
    content: str
    model: str = ""
    usage: dict = None
    finish_reason: str = "stop"

    def __post_init__(self):
        if self.usage is None:
            self.usage = {}


class LLMClient:
    # Единственный встроенный (обязательный) провайдер — GigaChat.
    # DeepSeek и прочие подключаются пользователем как custom (OpenAI-совместимый эндпоинт).
    BUILTIN_PROVIDERS = ["gigachat"]
    SUPPORTED_PROVIDERS = BUILTIN_PROVIDERS

    def __init__(self, provider: str = "gigachat"):
        self.provider = provider.lower()
        self.custom_config = None
        if self.provider not in self.BUILTIN_PROVIDERS:
            self.custom_config = _get_custom_provider(self.provider)
            if not self.custom_config:
                raise ValueError(
                    "Unknown provider: " + self.provider +
                    ". Built-in: " + ", ".join(self.BUILTIN_PROVIDERS) +
                    ". Custom providers must be configured in Settings."
                )
        self._init_client()

    def _init_client(self):
        if self.provider == "gigachat":
            self._init_gigachat()
        else:
            self._init_custom()

    def _init_gigachat(self):
        self.auth_type = _auth_type("GIGACHAT")
        self.model = _env("GIGACHAT_MODEL", "GigaChat") or "GigaChat"
        self.base_url = _env("GIGACHAT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1").rstrip("/")

        # Certificate (mTLS): ходим НАПРЯМУЮ по httpx, как рабочий curl — без SDK и без OAuth.
        # SDK в ряде версий даже в cert-режиме пытается получить токен; прямой путь надёжнее.
        if self.auth_type == "certificate":
            import httpx
            cert_file = _env("GIGACHAT_CLIENT_CERT_PATH")
            key_file = _env("GIGACHAT_CLIENT_KEY_PATH")
            if not cert_file:
                raise ValueError("GIGACHAT_CLIENT_CERT_PATH not found for certificate auth")
            # .txt с Base64-PEM (СберCA) автоматически распаковываются в нормальный PEM
            cert_file = _resolve_pem_path(cert_file)
            key_file = _resolve_pem_path(key_file)
            ca = _resolve_pem_path(_env("GIGACHAT_CA_CERT_PATH"))
            no_verify = _gigachat_no_verify()
            # SSL_NO_VERIFY / GIGACHAT_NO_VERIFY / SSL_MAX_TLS12 / CA учитываются.
            # Порядок как в list_gigachat_models — чат и /models ходят одинаково.
            verify = False if no_verify else (ca if ca else _get_verify())
            cert = (cert_file, key_file) if key_file else cert_file
            logger.info(
                "GigaChat init (certificate): base_url=%s model=%s no_verify=%s ca=%s",
                self.base_url, self.model, no_verify, bool(ca),
            )
            self._giga_http = httpx.Client(timeout=120.0, verify=verify, cert=cert)
            self.client = None
            return

        # API key: через SDK (OAuth-токен).
        from gigachat import GigaChat
        credentials = _env("GIGACHAT_AUTH_KEY") or _env("GIGACHAT_CREDENTIALS")
        if not credentials:
            raise ValueError("GIGACHAT_AUTH_KEY not found in settings")
        client_kwargs = {
            "scope": _env("GIGACHAT_SCOPE", "GIGACHAT_API_PERS") or "GIGACHAT_API_PERS",
            "model": self.model,
            "timeout": 120.0,
            "credentials": credentials,
            **_gigachat_tls_kwargs(),
        }
        if self.base_url:
            client_kwargs["base_url"] = self.base_url
        auth_url = _env("GIGACHAT_AUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth")
        if auth_url:
            client_kwargs["auth_url"] = auth_url
        logger.info(
            "GigaChat init (api_key): base_url=%s model=%s auth_url=%s",
            self.base_url, self.model, auth_url,
        )
        self.client = GigaChat(**client_kwargs)

    def _init_custom(self):
        import httpx
        cfg = self.custom_config or {}
        self.base_url = str(cfg.get("base_url", "")).rstrip("/")
        self.model = str(cfg.get("model", "")).strip()
        self.auth_type = str(cfg.get("auth_type", "api_key")).strip() or "api_key"
        self.api_key = str(cfg.get("api_key", "")).strip()
        if self.auth_type not in ("api_key", "certificate"):
            raise ValueError("Custom LLM auth_type must be api_key or certificate")
        if not self.base_url:
            raise ValueError("Custom LLM base_url is empty")
        if not self.model:
            raise ValueError("Custom LLM model is empty")
        if self.auth_type == "api_key" and not self.api_key:
            raise ValueError("Custom LLM API key is empty")

        ca_path = str(cfg.get("ca_cert_path", "")).strip()
        verify = _resolve_pem_path(ca_path) if ca_path else _get_verify()
        client_cert = _resolve_pem_path(str(cfg.get("client_cert_path", "")).strip())
        client_key = _resolve_pem_path(str(cfg.get("client_key_path", "")).strip())
        if self.auth_type == "certificate" and not client_cert:
            raise ValueError("Custom LLM client certificate path is empty")
        cert = (client_cert, client_key) if client_cert and client_key else (client_cert or None)
        self.client = httpx.Client(timeout=180.0, verify=verify, cert=cert)

    def chat(self, messages: List[Message],
             temperature: float = 0.7,
             max_tokens: int = 4000,
             model: str = "") -> LLMResponse:
        if self.provider == "gigachat":
            return self._chat_gigachat(messages, temperature, max_tokens, model)
        return self._chat_custom(messages, temperature, max_tokens, model)

    def _chat_gigachat(self, messages, temperature, max_tokens, model_override: str = ""):
        model = model_override or self.model
        # Certificate (mTLS): прямой POST /chat/completions по httpx (как curl), без SDK/OAuth.
        if self.auth_type == "certificate":
            payload = {
                "model": model,
                "messages": [{"role": m.role, "content": m.content} for m in messages],
            }
            if temperature is not None:
                payload["temperature"] = temperature
            if max_tokens:
                payload["max_tokens"] = max_tokens
            resp = self._giga_http.post(
                self.base_url + "/chat/completions",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            choice = data["choices"][0]
            return LLMResponse(
                content=choice["message"]["content"],
                model=data.get("model", model),
                usage=data.get("usage", {}),
                finish_reason=str(choice.get("finish_reason") or "stop"),
            )

        import time
        from gigachat.models import Chat, Messages
        chat = Chat(
            model=model,
            messages=[Messages(role=m.role, content=m.content) for m in messages],
            temperature=temperature,
            max_tokens=max_tokens
        )
        transient = ("peer closed", "incomplete chunked", "remoteprotocol",
                     "remote protocol", "connection reset", "server disconnected",
                     "incomplete read", "chunked encoding")
        last_err = None
        for attempt in range(3):
            try:
                response = self.client.chat(chat)
                usage = response.usage
                return LLMResponse(
                    content=response.choices[0].message.content,
                    model=response.model,
                    usage={
                        "prompt_tokens": usage.prompt_tokens,
                        "completion_tokens": usage.completion_tokens,
                        "total_tokens": usage.total_tokens,
                    } if usage else {},
                    finish_reason=str(response.choices[0].finish_reason or "stop"),
                )
            except Exception as e:
                emsg = str(e).lower()
                if any(x in emsg for x in transient):
                    last_err = e
                    if attempt < 2:
                        time.sleep(1.5 * (attempt + 1))
                        continue
                raise
        raise last_err

    def _custom_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.auth_type == "api_key":
            headers["Authorization"] = "Bearer " + self.api_key
        return headers

    def _chat_custom(self, messages, temperature, max_tokens, model_override: str = ""):
        payload = {
            "model": model_override or self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        response = self.client.post(
            self.base_url + "/chat/completions",
            json=payload,
            headers=self._custom_headers(),
        )
        response.raise_for_status()
        data = response.json()
        choice = data["choices"][0]
        content = choice.get("message", {}).get("content") or choice.get("text", "")
        return LLMResponse(
            content=content,
            model=data.get("model", model_override or self.model),
            usage=data.get("usage", {}),
            finish_reason=str(choice.get("finish_reason") or "stop"),
        )

    # ========================================================
    # ERROR CLASSIFIER — friendly messages for LLM errors
    # ========================================================
    @staticmethod
    def classify_error(e: Exception) -> tuple[bool, str]:
        """Returns (is_llm_error, friendly_russian_message)."""
        msg = str(e).lower()
        if "402" in msg or "payment" in msg or "quota" in msg or "insufficient" in msg or "balance" in msg:
            return True, "Ой! Закончились средства или квота у LLM-провайдера. Пополните баланс или смените провайдера в настройках."
        if "401" in msg or "403" in msg or "unauthorized" in msg or "forbidden" in msg or "authentication" in msg or "invalid api key" in msg:
            return True, "Ой! Ошибка авторизации LLM-провайдера. Проверьте API-ключ или смените провайдера в настройках."
        if "429" in msg or "rate limit" in msg or "too many requests" in msg or "ratelimit" in msg:
            return True, "Ой! Превышен лимит запросов к LLM-провайдеру. Подождите немного или смените провайдера."
        if ("ssl" in msg or "certificate" in msg or "certificate_verify_failed" in msg
                or "unexpected_eof" in msg or "eof occurred" in msg):
            return True, (
                "Ошибка SSL (корпоративный прокси). Быстрый способ: добавьте SSL_NO_VERIFY=1 в файл .env. "
                "Или запустите certs/build_bundle.sh и перезапустите сервер. "
                "Если ошибка повторяется — добавьте SSL_MAX_TLS12=1 в .env."
            )
        if any(x in msg for x in ("connectionerror", "connection refused", "connection error",
                                   "econnrefused", "timeout", "timed out", "read timeout",
                                   "connect timeout", "connection reset",
                                   "peer closed connection", "incomplete chunked read",
                                   "remoteprotocol", "remote protocol", "server disconnected",
                                   "chunked encoding", "incomplete read")):
            return True, "Ой! Не удалось подключиться к LLM-провайдеру. Проверьте настройки соединения или смените провайдера."
        if "500" in msg or "502" in msg or "503" in msg or "504" in msg or "bad gateway" in msg or "service unavailable" in msg:
            return True, "Ой! LLM-провайдер временно недоступен. Попробуйте позже или смените провайдера."
        return False, str(e)

    # ========================================================
    # HEALTH CHECK
    # ========================================================
    @staticmethod
    def health_check(provider_id: str) -> dict:
        """
        Returns: {"status": "green"|"yellow"|"red", "message": "..."}
        """
        try:
            if provider_id in LLMClient.BUILTIN_PROVIDERS:
                status = _builtin_status(provider_id)
                if status["status"] != "ready":
                    return {"status": "red", "message": status["message"]}
                response = LLMClient(provider_id).chat([Message(role="user", content="ping")], max_tokens=5)
                if response.content is not None:
                    return {"status": "green", "message": "OK"}
                return {"status": "yellow", "message": "Пустой ответ"}

            cfg = _get_custom_provider(provider_id)
            if cfg:
                client = LLMClient(provider_id)
                response = client.chat([Message(role="user", content="ping")], max_tokens=5)
                if response.content is not None:
                    return {"status": "green", "message": "OK"}
                return {"status": "yellow", "message": "Пустой ответ"}

            return {"status": "red", "message": "Неизвестный провайдер"}

        except Exception as e:
            errmsg = str(e)
            lower = errmsg.lower()
            if "402" in errmsg or "payment" in lower or "quota" in lower or "balance" in lower:
                return {"status": "yellow", "message": "Нет средств (402) — пополните баланс"}
            if "429" in errmsg or "rate limit" in lower or "too many requests" in lower:
                return {"status": "yellow", "message": "Rate limit (429)"}
            if "401" in errmsg or "403" in errmsg or "unauthorized" in lower:
                return {"status": "red", "message": "Ошибка авторизации"}
            return {"status": "red", "message": errmsg[:80]}

    @staticmethod
    def get_available_providers():
        """
        Returns built-in providers plus user-configured custom providers.
        Built-in providers are shown always with connection readiness.
        """
        providers = []

        providers.append(_builtin_status("gigachat"))

        for cfg in _load_custom_providers():
            provider_id = str(cfg.get("id", "")).strip().lower()
            name = str(cfg.get("name", "")).strip() or provider_id
            base_url = str(cfg.get("base_url", "")).strip()
            model = str(cfg.get("model", "")).strip()
            auth_type = str(cfg.get("auth_type", "api_key")).strip() or "api_key"
            api_key = str(cfg.get("api_key", "")).strip()
            client_cert = str(cfg.get("client_cert_path", "")).strip()
            ready = bool(
                base_url
                and model
                and (
                    (auth_type == "api_key" and api_key)
                    or (auth_type == "certificate" and client_cert)
                )
            )
            missing = []
            if not base_url:
                missing.append("URL")
            if not model:
                missing.append("модель")
            if auth_type == "api_key" and not api_key:
                missing.append("API key")
            if auth_type == "certificate" and not client_cert:
                missing.append("клиентский сертификат")
            providers.append({
                "id": provider_id,
                "name": name,
                "status": "ready" if ready else "no_key",
                "message": "OK" if ready else "Не настроено: " + ", ".join(missing),
            })

        return providers
