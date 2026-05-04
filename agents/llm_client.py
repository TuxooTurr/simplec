"""
Универсальный LLM клиент.

Встроенные провайдеры: GigaChat, DeepSeek.
Дополнительные провайдеры подключаются пользователем в настройках как
chat/completions-compatible endpoint через API key или TLS/client certificate.
"""

import json
import os
from dataclasses import dataclass
from typing import List


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


def _client_cert_from_env(prefix: str):
    cert_file = _env(prefix + "_CLIENT_CERT_PATH")
    key_file = _env(prefix + "_CLIENT_KEY_PATH")
    if cert_file and key_file:
        return (cert_file, key_file)
    return cert_file or None


def _verify_for_env(prefix: str):
    ca_cert = _env(prefix + "_CA_CERT_PATH")
    return ca_cert or _get_verify()


def _gigachat_tls_kwargs() -> dict:
    """Translate shared env/cert settings into kwargs accepted by gigachat SDK."""
    kwargs: dict = {}
    explicit_ca = _env("GIGACHAT_CA_CERT_PATH")
    global_ca = _env("SSL_CERT_FILE")
    ca_cert = explicit_ca or (global_ca if global_ca and os.path.exists(global_ca) else "")
    if ca_cert:
        kwargs["ca_bundle_file"] = ca_cert
        kwargs["verify_ssl_certs"] = True
    elif os.environ.get("SSL_NO_VERIFY", "").lower() in ("1", "true", "yes"):
        kwargs["verify_ssl_certs"] = False
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

    if provider_id == "deepseek":
        try:
            auth = _auth_type("DEEPSEEK")
        except ValueError as e:
            return {"id": "deepseek", "name": "DeepSeek", "status": "no_key", "message": str(e)}
        base_url = _env("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
        model = _env("DEEPSEEK_MODEL", "deepseek-chat")
        api_key = _env("DEEPSEEK_API_KEY")
        cert_file = _env("DEEPSEEK_CLIENT_CERT_PATH")
        missing = []
        if not base_url:
            missing.append("URL")
        if not model:
            missing.append("модель")
        if auth == "api_key" and not api_key:
            missing.append("DEEPSEEK_API_KEY")
        if auth == "certificate" and not cert_file:
            missing.append("клиентский сертификат")
        return {
            "id": "deepseek",
            "name": "DeepSeek",
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
    BUILTIN_PROVIDERS = ["gigachat", "deepseek"]
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
        elif self.provider == "deepseek":
            self._init_deepseek()
        else:
            self._init_custom()

    def _init_gigachat(self):
        from gigachat import GigaChat
        self.auth_type = _auth_type("GIGACHAT")
        self.model = _env("GIGACHAT_MODEL", "GigaChat") or "GigaChat"
        credentials = _env("GIGACHAT_AUTH_KEY") or _env("GIGACHAT_CREDENTIALS")
        client_kwargs = {
            "scope": _env("GIGACHAT_SCOPE", "GIGACHAT_API_PERS") or "GIGACHAT_API_PERS",
            "model": self.model,
            "timeout": 120.0,
            **_gigachat_tls_kwargs(),
        }
        base_url = _env("GIGACHAT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1")
        auth_url = _env("GIGACHAT_AUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth")
        if base_url:
            client_kwargs["base_url"] = base_url.rstrip("/")
        if auth_url:
            client_kwargs["auth_url"] = auth_url

        if self.auth_type == "api_key":
            if not credentials:
                raise ValueError("GIGACHAT_AUTH_KEY not found in settings")
            client_kwargs["credentials"] = credentials
        elif self.auth_type == "certificate":
            if not _env("GIGACHAT_CLIENT_CERT_PATH"):
                raise ValueError("GIGACHAT_CLIENT_CERT_PATH not found for certificate auth")

        self.client = GigaChat(**client_kwargs)

    def _init_deepseek(self):
        import httpx
        self.auth_type = _auth_type("DEEPSEEK")
        self.api_key = _env("DEEPSEEK_API_KEY")
        self.model = _env("DEEPSEEK_MODEL", "deepseek-chat") or "deepseek-chat"
        self.base_url = _env("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
        if not self.base_url:
            raise ValueError("DEEPSEEK_BASE_URL is empty")
        if self.auth_type == "api_key" and not self.api_key:
            raise ValueError("DEEPSEEK_API_KEY not found in settings")
        cert = _client_cert_from_env("DEEPSEEK")
        if self.auth_type == "certificate" and not cert:
            raise ValueError("DEEPSEEK_CLIENT_CERT_PATH not found for certificate auth")
        self.client = httpx.Client(timeout=120.0, verify=_verify_for_env("DEEPSEEK"), cert=cert)

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

        verify = str(cfg.get("ca_cert_path", "")).strip() or _get_verify()
        client_cert = str(cfg.get("client_cert_path", "")).strip()
        client_key = str(cfg.get("client_key_path", "")).strip()
        if self.auth_type == "certificate" and not client_cert:
            raise ValueError("Custom LLM client certificate path is empty")
        cert = (client_cert, client_key) if client_cert and client_key else (client_cert or None)
        self.client = httpx.Client(timeout=180.0, verify=verify, cert=cert)

    def chat(self, messages: List[Message],
             temperature: float = 0.7,
             max_tokens: int = 4000) -> LLMResponse:
        if self.provider == "gigachat":
            return self._chat_gigachat(messages, temperature, max_tokens)
        if self.provider == "deepseek":
            return self._chat_deepseek(messages, temperature, max_tokens)
        return self._chat_custom(messages, temperature, max_tokens)

    def _chat_gigachat(self, messages, temperature, max_tokens):
        import time
        from gigachat.models import Chat, Messages
        chat = Chat(
            model=self.model,
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
                return LLMResponse(
                    content=response.choices[0].message.content,
                    model=response.model,
                    usage={},
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

    def _chat_deepseek(self, messages, temperature, max_tokens):
        payload = {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        headers = {"Content-Type": "application/json"}
        if self.auth_type == "api_key":
            headers["Authorization"] = "Bearer " + self.api_key
        response = self.client.post(
            self.base_url + "/chat/completions",
            json=payload,
            headers=headers,
        )
        if response.status_code == 402:
            raise ValueError("DeepSeek: недостаточно средств (402 Payment Required). Пополните баланс.")
        if response.status_code == 429:
            raise ValueError("DeepSeek: превышен лимит запросов (429 Too Many Requests).")
        response.raise_for_status()
        data = response.json()
        return LLMResponse(
            content=data["choices"][0]["message"]["content"],
            model=self.model,
            usage=data.get("usage", {})
        )

    def _custom_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.auth_type == "api_key":
            headers["Authorization"] = "Bearer " + self.api_key
        return headers

    def _chat_custom(self, messages, temperature, max_tokens):
        payload = {
            "model": self.model,
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
            model=data.get("model", self.model),
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
        providers.append(_builtin_status("deepseek"))

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
