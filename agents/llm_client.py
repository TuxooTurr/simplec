"""
Универсальный LLM клиент.
Провайдеры: GigaChat, DeepSeek, Ollama, LM Studio
Health-check с автопингом.
"""

import os
from dataclasses import dataclass
from typing import List


@dataclass
class Message:
    role: str
    content: str


@dataclass
class LLMResponse:
    content: str
    model: str = ""
    usage: dict = None
    finish_reason: str = "stop"  # "stop" | "length" | "content_filter"

    def __post_init__(self):
        if self.usage is None:
            self.usage = {}


class LLMClient:
    SUPPORTED_PROVIDERS = ["gigachat", "deepseek", "ollama", "lmstudio"]

    def __init__(self, provider: str = "ollama"):
        self.provider = provider.lower()
        if self.provider not in self.SUPPORTED_PROVIDERS:
            raise ValueError(
                "Unknown provider: " + self.provider +
                ". Supported: " + ", ".join(self.SUPPORTED_PROVIDERS)
            )
        self._init_client()

    def _init_client(self):
        if self.provider == "gigachat":
            self._init_gigachat()
        elif self.provider == "deepseek":
            self._init_deepseek()
        elif self.provider == "ollama":
            self._init_ollama()
        elif self.provider == "lmstudio":
            self._init_lmstudio()

    def _init_gigachat(self):
        from gigachat import GigaChat
        credentials = os.getenv("GIGACHAT_AUTH_KEY") or os.getenv("GIGACHAT_CREDENTIALS")
        if not credentials:
            raise ValueError("GIGACHAT_AUTH_KEY not found in .env")
        scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
        self.client = GigaChat(
            credentials=credentials,
            verify_ssl_certs=False,
            scope=scope
        )

    def _init_deepseek(self):
        import httpx
        self.api_key = os.getenv("DEEPSEEK_API_KEY")
        if not self.api_key:
            raise ValueError("DEEPSEEK_API_KEY not found in .env")
        self.client = httpx.Client(timeout=120.0)
        self.base_url = "https://api.deepseek.com/v1"

    def _init_ollama(self):
        import ollama
        self.client = ollama

    def _init_lmstudio(self):
        import httpx
        self.client = httpx.Client(timeout=180.0)
        self.base_url = os.getenv("LMSTUDIO_URL", "http://localhost:1234/v1")

    def chat(self, messages: List[Message],
             temperature: float = 0.7,
             max_tokens: int = 4000) -> LLMResponse:
        if self.provider == "gigachat":
            return self._chat_gigachat(messages, temperature, max_tokens)
        elif self.provider == "deepseek":
            return self._chat_deepseek(messages, temperature, max_tokens)
        elif self.provider == "ollama":
            return self._chat_ollama(messages, temperature, max_tokens)
        elif self.provider == "lmstudio":
            return self._chat_lmstudio(messages, temperature, max_tokens)

    def _chat_gigachat(self, messages, temperature, max_tokens):
        from gigachat.models import Chat, Messages
        chat = Chat(
            messages=[Messages(role=m.role, content=m.content) for m in messages],
            temperature=temperature,
            max_tokens=max_tokens
        )
        response = self.client.chat(chat)
        return LLMResponse(
            content=response.choices[0].message.content,
            model=response.model,
            usage={},
            finish_reason=str(response.choices[0].finish_reason or "stop"),
        )

    def _chat_deepseek(self, messages, temperature, max_tokens):
        payload = {
            "model": "deepseek-chat",
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        response = self.client.post(
            self.base_url + "/chat/completions",
            json=payload,
            headers={"Authorization": "Bearer " + self.api_key}
        )
        if response.status_code == 402:
            raise ValueError("DeepSeek: недостаточно средств (402 Payment Required). Пополните баланс.")
        if response.status_code == 429:
            raise ValueError("DeepSeek: превышен лимит запросов (429 Too Many Requests).")
        response.raise_for_status()
        data = response.json()
        return LLMResponse(
            content=data["choices"][0]["message"]["content"],
            model="deepseek-chat",
            usage=data.get("usage", {})
        )

    def _chat_ollama(self, messages, temperature, max_tokens):
        response = self.client.chat(
            model="llama3.1:latest",
            messages=[{"role": m.role, "content": m.content} for m in messages],
            options={"temperature": temperature, "num_predict": max_tokens}
        )
        return LLMResponse(
            content=response["message"]["content"],
            model="llama3.1:latest"
        )

    def _chat_lmstudio(self, messages, temperature, max_tokens):
        payload = {
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False
        }
        response = self.client.post(
            self.base_url + "/chat/completions",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        response.raise_for_status()
        data = response.json()
        return LLMResponse(
            content=data["choices"][0]["message"]["content"],
            model=data.get("model", "lmstudio"),
            usage=data.get("usage", {})
        )

    # ========================================================
    # HEALTH CHECK — mini ping to verify LLM is alive
    # ========================================================
    @staticmethod
    def health_check(provider_id: str) -> dict:
        """
        Returns: {"status": "green"|"yellow"|"red", "message": "..."}
        green  = working
        yellow = auth ok but no funds / rate limit
        red    = unreachable / no key / error
        """
        try:
            if provider_id == "gigachat":
                credentials = os.getenv("GIGACHAT_AUTH_KEY") or os.getenv("GIGACHAT_CREDENTIALS")
                if not credentials:
                    return {"status": "red", "message": "Нет ключа GIGACHAT_AUTH_KEY"}
                from gigachat import GigaChat
                scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
                client = GigaChat(
                    credentials=credentials,
                    verify_ssl_certs=False,
                    scope=scope
                )
                models = client.get_models()
                return {"status": "green", "message": "OK, модели: " + str(len(models.data))}

            elif provider_id == "deepseek":
                api_key = os.getenv("DEEPSEEK_API_KEY")
                if not api_key:
                    return {"status": "red", "message": "Нет ключа DEEPSEEK_API_KEY"}
                import httpx
                r = httpx.post(
                    "https://api.deepseek.com/v1/chat/completions",
                    json={
                        "model": "deepseek-chat",
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 5
                    },
                    headers={"Authorization": "Bearer " + api_key},
                    timeout=15.0
                )
                if r.status_code == 200:
                    return {"status": "green", "message": "OK"}
                elif r.status_code == 402:
                    return {"status": "yellow", "message": "Нет средств (402)"}
                elif r.status_code == 429:
                    return {"status": "yellow", "message": "Rate limit (429)"}
                else:
                    return {"status": "red", "message": "HTTP " + str(r.status_code)}

            elif provider_id == "ollama":
                try:
                    import ollama
                    models = ollama.list()
                    count = len(models.get("models", []))
                    if count > 0:
                        return {"status": "green", "message": "OK, модели: " + str(count)}
                    else:
                        return {"status": "yellow", "message": "Запущен, но нет моделей"}
                except Exception:
                    return {"status": "red", "message": "Не запущен"}

            elif provider_id == "lmstudio":
                import httpx
                url = os.getenv("LMSTUDIO_URL", "http://localhost:1234/v1")
                r = httpx.get(url + "/models", timeout=3.0)
                if r.status_code == 200:
                    data = r.json()
                    count = len(data.get("data", []))
                    return {"status": "green", "message": "OK, модели: " + str(count)}
                else:
                    return {"status": "red", "message": "HTTP " + str(r.status_code)}

            return {"status": "red", "message": "Неизвестный провайдер"}

        except Exception as e:
            msg = str(e)[:80]
            return {"status": "red", "message": msg}

    @staticmethod
    def get_available_providers():
        """
        Returns only actually usable providers.
        Cloud providers (GigaChat, DeepSeek) are shown always (with key status).
        Local providers (Ollama, LM Studio) are shown ONLY if running on this machine.
        """
        providers = []

        cred = os.getenv("GIGACHAT_AUTH_KEY") or os.getenv("GIGACHAT_CREDENTIALS")
        if cred:
            providers.append({"id": "gigachat", "name": "GigaChat", "status": "ready"})
        else:
            providers.append({"id": "gigachat", "name": "GigaChat", "status": "no_key"})

        if os.getenv("DEEPSEEK_API_KEY"):
            providers.append({"id": "deepseek", "name": "DeepSeek", "status": "ready"})

        # Local providers — show only if actually reachable on this machine
        try:
            import ollama
            ollama.list()
            providers.append({"id": "ollama", "name": "Ollama", "status": "ready"})
        except Exception:
            pass  # not installed or not running — skip silently

        try:
            import httpx
            url = os.getenv("LMSTUDIO_URL", "http://localhost:1234/v1")
            r = httpx.get(url + "/models", timeout=2.0)
            if r.status_code == 200:
                providers.append({"id": "lmstudio", "name": "LM Studio", "status": "ready"})
        except Exception:
            pass  # not running — skip silently

        return providers
