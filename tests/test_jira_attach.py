"""Вложения при регистрации в Jira tool: любые файлы, имена из описания, понятная ошибка при отказе Jira."""

import asyncio
import io

import pytest
from starlette.datastructures import Headers, UploadFile

import backend.api.jira_defects as jd


class _Resp:
    def __init__(self, status: int, body):
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def _upload(name: str, data: bytes = b"x", ctype: str = "application/octet-stream") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name, headers=Headers({"content-type": ctype}))


@pytest.fixture
def jira(monkeypatch):
    sent: dict = {}
    monkeypatch.setattr(jd, "_load_cfg", lambda db: {"base_url": "https://jira.example", "token": "t", "token_path": "", "ssl_verify": False})

    def post(url, files, headers, verify, timeout):
        sent.update(url=url, names=[f[1][0] for f in files], types=[f[1][2] for f in files], headers=headers)
        return sent.get("resp") or _Resp(200, [{"filename": f[1][0]} for f in files])

    import requests
    monkeypatch.setattr(requests, "post", post)
    return sent


def _attach(files, names):
    return asyncio.run(jd.attach_files("SBER911-1", files=files, names=names, db=None))


def test_любые_файлы_уходят_под_именами_из_описания(jira):
    r = _attach([_upload("image.png", ctype="image/png"), _upload("record.mp4", ctype="video/mp4"), _upload("app.log")],
                ["screenshot-20261017-140321.png", "record.mp4", "app.log"])
    assert jira["url"] == "https://jira.example/rest/api/2/issue/SBER911-1/attachments"
    assert jira["names"] == ["screenshot-20261017-140321.png", "record.mp4", "app.log"]
    assert jira["types"] == ["image/png", "video/mp4", "application/octet-stream"]
    assert jira["headers"]["X-Atlassian-Token"] == "no-check"
    assert r == {"attached": ["screenshot-20261017-140321.png", "record.mp4", "app.log"], "warnings": []}


def test_без_имени_берётся_имя_файла(jira):
    _attach([_upload("a.txt"), _upload("b.txt")], ["", ""])
    assert jira["names"] == ["a.txt", "b.txt"]


def test_слишком_большой_файл_понятная_ошибка_а_не_падение(jira):
    jira["resp"] = _Resp(413, "too large")
    r = _attach([_upload("huge.mp4")], ["huge.mp4"])
    assert r["attached"] == []
    assert "SBER911-1 создана" in r["warnings"][0] and "слишком большой файл" in r["warnings"][0]


def test_без_файлов_jira_не_вызывается(jira):
    assert _attach([], []) == {"attached": [], "warnings": []}
    assert "url" not in jira
