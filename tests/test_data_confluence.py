"""«Данные»: требования из Confluence (storage → Markdown, дерево страниц, несколько СТ), версии и их сравнение,
единый вход в Jira и Confluence."""

import asyncio

import pytest
from fastapi import HTTPException

import db.requirements_store as rs
from agents.confluence_md import storage_to_markdown
from agents.md_diff import diff
from backend.api import requirements as api
from db.requirements_store import RequirementsStore as S


@pytest.fixture(autouse=True)
def files(tmp_path, monkeypatch):
    monkeypatch.setattr(rs, "_FILE", tmp_path / "requirements.json")
    monkeypatch.setattr(rs, "_FOLDERS", tmp_path / "requirement_folders.json")


def test_storage_в_markdown_макросы_таблицы_ссылки():
    xml = ('<h1>СТ-12 Карточка</h1><p>Показывает <strong>всё</strong>&nbsp;сразу.<br/>Строка 2.</p>'
           '<ac:structured-macro ac:name="toc"/>'
           '<ul><li><p>Номер</p><ul><li>формат INC</li></ul></li><li>см. <ac:link><ri:page ri:content-title="СТ-13" ri:space-key="S"/>'
           '<ac:plain-text-link-body><![CDATA[адреса]]></ac:plain-text-link-body></ac:link></li></ul>'
           '<table><tbody><tr><th>Поле</th><th>Тип</th></tr><tr><td><p>status</p></td><td><p>enum</p><p>A|B</p></td></tr></tbody></table>'
           '<ac:structured-macro ac:name="warning"><ac:parameter ac:name="title">Важно</ac:parameter><ac:rich-text-body><p>Нельзя.</p></ac:rich-text-body></ac:structured-macro>'
           '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">sql</ac:parameter><ac:plain-text-body><![CDATA[SELECT 1;]]></ac:plain-text-body></ac:structured-macro>'
           '<p>Статус: <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">ok</ac:parameter></ac:structured-macro> '
           '<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">SBER911-5</ac:parameter></ac:structured-macro></p>'
           '<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>Готово</ac:task-body></ac:task></ac:task-list>'
           '<p><ac:image><ri:attachment ri:filename="flow.png"/></ac:image></p>')
    assert storage_to_markdown(xml, "https://c.ru", "S") == (
        "# СТ-12 Карточка\n\nПоказывает **всё** сразу.\nСтрока 2.\n\n- Номер\n  - формат INC\n- см. [адреса](https://c.ru/display/S/%D0%A1%D0%A2-13)\n\n"
        "| Поле | Тип |\n|---|---|\n| status | enum; A\\|B |\n\n> **Важно**\n>\n> Нельзя.\n\n```sql\nSELECT 1;\n```\n\n"
        "Статус: [OK] SBER911-5\n\n- [x] Готово\n\n*[изображение: flow.png]*")


def test_свод_без_шума_ссылки_на_источник_и_разметки():
    old = "> Источник: [СТ](http://c/1) · версия Confluence 1\n\n## Поля\n\n| Поле | Тип |\n|---|---|\n| Номер | **string** |"
    new = "> Источник: [СТ](http://c/1) · версия Confluence 2\n\n## Поля\n\n| Поле | Тип |\n|---|---|\n| Номер | **string** |\n| Статус | `enum` |"
    assert [(x["kind"], x["text"]) for x in diff(old, new)["items"]] == [("added", "Статус · enum")]


def test_свод_изменений_по_разделам():
    old = "# Карточка\n\nПоказывает данные.\n\n## Поля\n\n- Номер\n- Адрес\n\n## Права\n\nЧитают все."
    new = "# Карточка\n\nПоказывает данные инцидента.\n\n## Поля\n\n- Номер\n- Адрес\n- Статус\n\n## Права\n\nЧитают все."
    d = diff(old, new)
    assert (d["added"], d["changed"], d["removed"]) == (1, 1, 0)
    assert {(x["kind"], x["section"], x["text"]) for x in d["items"]} == {
        ("changed", "Карточка", "Показывает данные инцидента."), ("added", "Поля", "Статус")}
    gone = diff(new, old)
    assert gone["removed"] == 1 and gone["items"][-1]["was"] == "Поля"


PAGES = {
    "1": {"id": "1", "title": "Карточка", "version": {"number": 3}, "space": {"key": "S"},
          "_links": {"webui": "/pages/viewpage.action?pageId=1"}, "body": {"storage": {"value": "<h1>Поля</h1><p>Номер.</p>"}}},
    "2": {"id": "2", "title": "СТ Адреса", "version": {"number": 1}, "space": {"key": "S"},
          "_links": {"webui": "/display/S/2"}, "body": {"storage": {"value": "<p>Адрес по ФИАС.</p>"}}},
    "3": {"id": "3", "title": "СТ Права", "version": {"number": 1}, "space": {"key": "S"},
          "_links": {"webui": "/display/S/3"}, "body": {"storage": {"value": "<p>Только дежурный.</p>"}}},
}
CHILDREN = {"1": ["2"], "2": ["3"], "3": []}


@pytest.fixture
def confluence(monkeypatch):
    from backend.api import confluence as cf
    calls = []

    def request(cfg, method, path, params=None, **kw):
        calls.append(path)
        if path.endswith("/child/page"):
            return {"results": [PAGES[i] for i in CHILDREN[path.split("/")[-3]]]}
        if path.startswith("/rest/api/content/"):
            return PAGES[path.split("/")[-1]]
        return {"results": [p for p in PAGES.values() if p["title"] == params["title"]]}
    monkeypatch.setattr(cf, "_request", request)
    monkeypatch.setattr(cf, "_load_cfg", lambda db: {"base_url": "https://c.ru", "space": "S", "token": "t", "token_path": "", "ssl_verify": False})
    return calls


def test_импорт_страницы_с_дочерними_деревом_папок(confluence):
    r = asyncio.run(api.confluence_import(api.ConfluenceImport(ref="https://c.ru/pages/viewpage.action?pageId=1", children=True, focus="только поля")))
    assert r["folders"] == 2 and [d["name"] for d in r["created"]] == ["Карточка", "СТ Адреса", "СТ Права"]
    folders = {f["id"]: f for f in S.list_folders()}
    root, adr, prava = r["created"]
    assert folders[root["folder_id"]]["name"] == "Карточка" and folders[adr["folder_id"]]["name"] == "СТ Адреса"
    assert folders[adr["folder_id"]]["parent_id"] == root["folder_id"] and prava["folder_id"] == adr["folder_id"]
    assert root["text"].startswith("> Источник: [Карточка](https://c.ru/pages/viewpage.action?pageId=1) · версия Confluence 3")
    assert root["focus"] == "только поля" and root["sources"] == [{"id": "1", "title": "Карточка", "url": "https://c.ru/pages/viewpage.action?pageId=1", "version": 3}]


def test_вторая_ст_разделом_и_новой_версией(confluence):
    doc = asyncio.run(api.confluence_import(api.ConfluenceImport(ref="1")))["created"][0]
    S.update_requirement(doc["id"], qa_doc="# QA v1")
    got = asyncio.run(api.add_source(doc["id"], api.AddSourceBody(ref="https://c.ru/display/S/СТ+Адреса", as_version=True)))
    assert got["version"] == 2 and got["qa_doc"] == "" and got["version_note"] == "Добавлена СТ «СТ Адреса»"
    assert got["text"].startswith("## Карточка\n\n> Источник:") and "\n\n## СТ Адреса\n\n> Источник: [СТ Адреса]" in got["text"]
    assert "### Поля" in got["text"]                              # заголовки СТ — под её разделом
    assert got["versions"][0]["n"] == 1 and got["versions"][0]["qa_doc"] == "# QA v1"
    with pytest.raises(HTTPException) as e:
        asyncio.run(api.add_source(doc["id"], api.AddSourceBody(ref="2")))
    assert e.value.status_code == 409


def test_обновление_из_confluence_только_если_страница_изменилась(confluence):
    doc = asyncio.run(api.confluence_import(api.ConfluenceImport(ref="1")))["created"][0]
    assert asyncio.run(api.sync_sources(doc["id"]))["changed"] is False
    PAGES["1"]["version"]["number"] = 5
    PAGES["1"]["body"]["storage"]["value"] = "<h1>Поля</h1><p>Номер.</p><p>Статус.</p>"
    try:
        r = asyncio.run(api.sync_sources(doc["id"]))
    finally:
        PAGES["1"]["version"]["number"] = 3
        PAGES["1"]["body"]["storage"]["value"] = "<h1>Поля</h1><p>Номер.</p>"
    assert r["changed"] and r["item"]["version"] == 2 and r["item"]["version_note"] == "Обновлено из Confluence: «Карточка» v3 → v5"
    d = api.version_diff(doc["id"], a=1, b=2, field="auto")
    assert d["field"] == "text" and [(x["kind"], x["section"], x["text"]) for x in d["items"] if x["kind"] != "changed"] == [("added", "Поля", "Статус.")]


def test_ручная_новая_версия_и_сравнение_qa(confluence):
    d = S.add_requirement("Док", "", "Текст v1")
    S.update_requirement(d["id"], qa_doc="## Поля\n\n- Номер")
    api.new_version(d["id"], api.NewVersionBody(text="Текст v2", note="добавили статус"))
    S.update_requirement(d["id"], qa_doc="## Поля\n\n- Номер\n- Статус")
    r = api.version_diff(d["id"], a=1, b=2, field="auto")
    assert r["field"] == "qa_doc" and r["items"] == [{"kind": "added", "section": "Поля", "text": "Статус", "heading": False}]
    with pytest.raises(HTTPException):
        api.version_diff(d["id"], a=7, b=2, field="auto")


def test_единый_вход_маркеры_для_обеих_систем(monkeypatch):
    from backend.api import confluence as cf, corp_auth, jira_defects as jd
    seen = []

    def ok(body, db):
        seen.append(("jira", body.login, body.password))

    def deny(body, db):
        raise HTTPException(401, "Confluence не выдал маркер")
    monkeypatch.setattr(jd, "token_from_login", ok)
    monkeypatch.setattr(cf, "token_from_login", deny)
    monkeypatch.setattr(corp_auth, "_status", lambda db: {"jira": {"hasToken": True}, "confluence": {"hasToken": False}})

    class DB:
        def rollback(self):
            pass
    r = corp_auth.login(corp_auth.CorpLogin(login="u", password="p"), DB())
    assert seen == [("jira", "u", "p")]
    assert r["results"]["jira"]["ok"] and not r["results"]["confluence"]["ok"]
    assert r["results"]["confluence"]["text"].startswith("неверный логин или пароль")


def test_промт_учитывает_название_и_уточнение():
    from agents.layered_generator import LayeredGenerator

    class FakeLLM:
        prompt = ""

        def chat_continued(self, messages, **kw):
            FakeLLM.prompt = messages[0].content
            return type("R", (), {"content": "# Док", "finish_reason": "stop"})()
    LayeredGenerator(FakeLLM()).generate_qa_doc("СТ1… СТ2…", "", "", True, "Экспорт карточки", "только выгрузка в PDF")
    assert "Функция (название документа): Экспорт карточки" in FakeLLM.prompt
    assert "Что именно нужно: только выгрузка в PDF" in FakeLLM.prompt and "несколько СТ" in FakeLLM.prompt
    LayeredGenerator(FakeLLM()).generate_qa_doc("Т", "Ф")
    assert "О ЧЁМ ДОКУМЕНТ" not in FakeLLM.prompt


# ── Рисунки, несколько ссылок, связанные страницы для документа QA ─────────────

@pytest.fixture
def assets(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "ASSETS_DIR", tmp_path / "assets")
    return tmp_path / "assets"


PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 20


def test_картинки_страницы_скачиваются_к_нам_или_остаётся_пометка(confluence, assets, monkeypatch):
    from backend.api import confluence as cf

    def download(cfg, page, name):
        if name == "нет.png":
            raise HTTPException(404, "нет вложения")
        return PNG, "image/png"
    monkeypatch.setattr(cf, "download_attachment", download)
    md = "![схема](attachment:1/flow%20chart.png) и ![](attachment:1/%D0%BD%D0%B5%D1%82.png) и ![x](attachment:1/flow%20chart.png)"
    out = api.resolve_attachments(md, "store")
    url = out.split("(")[1].split(")")[0]
    assert url.startswith("/api/requirements/assets/") and url.endswith(".png") and out.count(url) == 2
    assert "*[изображение: «нет.png» не скачалось из Confluence]*" in out
    assert len(list(assets.iterdir())) == 1                                    # одинаковые — один файл
    assert api.resolve_attachments("![a](attachment:7/f.png)", "proxy") == "![a](/api/requirements/confluence/attachment?page=7&file=f.png)"
    assert str(api.get_asset(url.rsplit("/", 1)[1]).path).endswith(".png")
    with pytest.raises(HTTPException):
        api.get_asset("../secret.png")


def test_загрузка_картинки_из_редактора(assets):
    from fastapi import UploadFile
    import io
    r = asyncio.run(api.upload_asset(UploadFile(file=io.BytesIO(PNG), filename="paste.png", headers={"content-type": "image/png"})))
    assert r["url"].startswith("/api/requirements/assets/")
    with pytest.raises(HTTPException) as e:
        asyncio.run(api.upload_asset(UploadFile(file=io.BytesIO(b"MZ"), filename="x.exe", headers={"content-type": "application/x-msdownload"})))
    assert e.value.status_code == 415


def test_один_документ_из_нескольких_ссылок_со_своим_названием(confluence, assets):
    r = asyncio.run(api.confluence_import(api.ConfluenceImport(refs=["1", "https://c.ru/display/S/СТ+Адреса", "1"], name=" Экспорт карточки ")))
    doc = r["created"][0]
    assert len(r["created"]) == 1 and doc["name"] == "Экспорт карточки"
    assert [s["id"] for s in doc["sources"]] == ["1", "2"]
    assert doc["text"].startswith("## Карточка\n\n> Источник:") and "\n\n## СТ Адреса\n\n> Источник:" in doc["text"]
    with pytest.raises(HTTPException):
        asyncio.run(api.confluence_import(api.ConfluenceImport()))


def test_ссылки_документа_для_сборки_qa(confluence):
    text = ("> Источник: [Карточка](https://c.ru/pages/viewpage.action?pageId=1) · версия 3\n\n"
            "Та же страница по заголовку: [карточка](https://c.ru/display/S/Карточка). "
            "См. [СТ-13](https://c.ru/display/S/СТ-13), [права](https://c.ru/pages/viewpage.action?pageId=3), "
            "[ТЗ.pdf](https://c.ru/download/attachments/1/ТЗ.pdf), [Google](https://google.com), ![p](https://c.ru/pages/viewpage.action?pageId=9)")
    d = S.add_requirement("Док", "", text, sources=[{"id": "1", "title": "Карточка", "url": "https://c.ru/pages/viewpage.action?pageId=1", "version": 3}])
    r = api.document_links(d["id"])
    assert [s["id"] for s in r["sources"]] == ["1"]
    assert r["found"] == [{"title": "СТ-13", "url": "https://c.ru/display/S/СТ-13"},
                          {"title": "права", "url": "https://c.ru/pages/viewpage.action?pageId=3"}]


def test_документ_qa_со_связанными_страницами(confluence, monkeypatch):
    from agents import llm_client
    seen = {}

    class FakeLLM:
        def __init__(self, provider):
            pass

        def chat_continued(self, messages, **kw):
            seen["prompt"] = messages[0].content
            return type("R", (), {"content": "# QA", "finish_reason": "stop"})()
    monkeypatch.setattr(llm_client, "LLMClient", FakeLLM)
    d = S.add_requirement("Экспорт карточки", "", "Исходник документа.")
    out = asyncio.run(api.generate_requirement_doc(d["id"], api.GenerateDocBody(provider="x", links=["2", "nope", "2"], focus="только PDF")))
    assert "Функция (название документа): Экспорт карточки" in seen["prompt"] and "Что именно нужно: только PDF" in seen["prompt"]
    assert "СВЯЗАННЫЕ СТРАНИЦЫ" in seen["prompt"] and "Адрес по ФИАС." in seen["prompt"]
    assert out["qa_links"] == [{"title": "СТ Адреса", "url": "https://c.ru/display/S/2"}] and out["focus"] == "только PDF"
    assert len(out["qa_link_errors"]) == 1 and out["qa_link_errors"][0].startswith("nope")
