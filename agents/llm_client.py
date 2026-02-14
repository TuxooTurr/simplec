"""
Универсальный LLM клиент с поддержкой разных провайдеров.
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
    
    def __post_init__(self):
        if self.usage is None:
            self.usage = {}

class LLMClient:
    def __init__(self, provider: str = "ollama"):
        self.provider = provider.lower()
        self._init_client()
    
    def _init_client(self):
        if self.provider == "gigachat":
            self._init_gigachat()
        elif self.provider == "deepseek":
            self._init_deepseek()
        elif self.provider == "openai":
            self._init_openai()
        elif self.provider == "ollama":
            self._init_ollama()
        elif self.provider == "lmstudio":
            self._init_lmstudio()
        else:
            raise ValueError(f"Unknown provider: {self.provider}")
    
    def _init_gigachat(self):
        from gigachat import GigaChat
        credentials = os.getenv("GIGACHAT_CREDENTIALS")
        self.client = GigaChat(credentials=credentials, verify_ssl_certs=False)
    
    def _init_deepseek(self):
        import httpx
        self.api_key = os.getenv("DEEPSEEK_API_KEY")
        self.client = httpx.Client(timeout=120.0)
        self.base_url = "https://api.deepseek.com/v1"
    
    def _init_openai(self):
        import httpx
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.client = httpx.Client(timeout=120.0)
        self.base_url = "https://api.openai.com/v1"
    
    def _init_ollama(self):
        import ollama
        self.client = ollama
    
    def _init_lmstudio(self):
        import httpx
        self.client = httpx.Client(timeout=180.0)
        self.base_url = os.getenv("LMSTUDIO_URL", "http://localhost:1234/v1")
    
    def chat(self, messages: List[Message], temperature: float = 0.7, max_tokens: int = 4000) -> LLMResponse:
        if self.provider == "gigachat":
            return self._chat_gigachat(messages, temperature, max_tokens)
        elif self.provider == "deepseek":
            return self._chat_deepseek(messages, temperature, max_tokens)
        elif self.provider == "openai":
            return self._chat_openai(messages, temperature, max_tokens)
        elif self.provider == "ollama":
            return self._chat_ollama(messages, temperature, max_tokens)
        elif self.provider == "lmstudio":
            return self._chat_lmstudio(messages, temperature, max_tokens)
    
    def _chat_gigachat(self, messages: List[Message], temperature: float, max_tokens: int) -> LLMResponse:
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
            usage={}
        )
    
    def _chat_deepseek(self, messages: List[Message], temperature: float, max_tokens: int) -> LLMResponse:
        payload = {
            "model": "deepseek-chat",
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        response = self.client.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {self.api_key}"}
        )
        response.raise_for_status()
        data = response.json()
        return LLMResponse(content=data["choices"][0]["message"]["content"], model="deepseek")
    
    def _chat_openai(self, messages: List[Message], temperature: float, max_tokens: int) -> LLMResponse:
        payload = {
            "model": "gpt-4o-mini",
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        response = self.client.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {self.api_key}"}
        )
        response.raise_for_status()
        data = response.json()
        return LLMResponse(content=data["choices"][0]["message"]["content"], model="openai")
    
    def _chat_ollama(self, messages: List[Message], temperature: float, max_tokens: int) -> LLMResponse:
        response = self.client.chat(
            model="llama3.1:latest",
            messages=[{"role": m.role, "content": m.content} for m in messages],
            options={"temperature": temperature, "num_predict": max_tokens}
        )
        return LLMResponse(content=response["message"]["content"], model="ollama")
    
    def _chat_lmstudio(self, messages: List[Message], temperature: float, max_tokens: int) -> LLMResponse:
        payload = {
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False
        }
        response = self.client.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        response.raise_for_status()
        data = response.json()
        return LLMResponse(content=data["choices"][0]["message"]["content"], model="lmstudio")
    
    @staticmethod
    def get_available_providers() -> list:
        providers = []
        
        if os.getenv("GIGACHAT_CREDENTIALS"):
            providers.append({"id": "gigachat", "name": "GigaChat", "status": "ready"})
        else:
            providers.append({"id": "gigachat", "name": "GigaChat", "status": "no_key"})
        
        if os.getenv("DEEPSEEK_API_KEY"):
            providers.append({"id": "deepseek", "name": "DeepSeek", "status": "ready"})
        else:
            providers.append({"id": "deepseek", "name": "DeepSeek", "status": "no_key"})
        
        if os.getenv("OPENAI_API_KEY"):
            providers.append({"id": "openai", "name": "OpenAI", "status": "ready"})
        else:
            providers.append({"id": "openai", "name": "OpenAI", "status": "no_key"})
        
        try:
            import ollama
            ollama.list()
            providers.append({"id": "ollama", "name": "Ollama", "status": "ready"})
        except:
            providers.append({"id": "ollama", "name": "Ollama", "status": "not_running"})
        
        try:
            import httpx
            r = httpx.get("http://localhost:1234/v1/models", timeout=2.0)
            if r.status_code == 200:
                providers.append({"id": "lmstudio", "name": "LM Studio", "status": "ready"})
            else:
                providers.append({"id": "lmstudio", "name": "LM Studio", "status": "not_running"})
        except:
            providers.append({"id": "lmstudio", "name": "LM Studio", "status": "not_running"})
        
        return providers
