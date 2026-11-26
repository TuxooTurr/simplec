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
            if messages[0].content.startswith("Ты — старший тестировщик"):
                seen["prompt"] = messages[0].content
            return type("R", (), {"content": "# QA", "finish_reason": "stop"})()
    monkeypatch.setattr(llm_client, "LLMClient", FakeLLM)
    d = S.add_requirement("Экспорт карточки", "", "Исходник документа.")
    out = asyncio.run(api.generate_requirement_doc(d["id"], api.GenerateDocBody(provider="x", links=["2", "nope", "2"], focus="только PDF")))
    assert "Функция (название документа): Экспорт карточки" in seen["prompt"] and "Что именно нужно: только PDF" in seen["prompt"]
    assert "СВЯЗАННЫЕ СТРАНИЦЫ" in seen["prompt"] and "Адрес по ФИАС." in seen["prompt"]
    assert out["qa_links"] == [{"title": "СТ Адреса", "url": "https://c.ru/display/S/2"}] and out["focus"] == "только PDF"
    assert len(out["qa_link_errors"]) == 1 and out["qa_link_errors"][0].startswith("nope")


def test_переработка_добавляет_версию_и_сохраняет_предыдущие():
    from agents.requirement_versions import build_release_pages

    item = {"text": "## V1 — Поиск\nЕсть поиск по имени."}
    calls = []

    def build(label, requirement):
        calls.append(label)
        return requirement

    first = asyncio.run(build_release_pages(item, build, str))
    item.update(release_pages=first, text=item["text"] + "\n\n## V2 — Сортировка\nПоявилась сортировка.")
    second = asyncio.run(build_release_pages(item, build, str))
    assert calls == ["V1", "V2"]
    assert second[0] == first[0]
    assert "сортировка" in second[1]["markdown"]
    assert "поиск" not in second[1]["markdown"]


def test_versii_from_confluence_tables_paragraphs_and_lists():
    from agents.requirement_versions import explicit_versions

    html = (
        "<h2>История изменений</h2>"
        "<table><tr><th>Дата</th><th>Версия</th><th>Что менялось</th></tr>"
        "<tr><td>01.10</td><td><strong>V1</strong></td><td>Базовый поиск</td></tr>"
        "<tr><td>02.10</td><td>2</td><td>Добавили расчёт</td></tr></table>"
        "<h2>Другие изменения</h2><p><strong>V3</strong> — параметр limit</p>"
        "<ul><li>V4 - возвращаем total</li></ul><h2>Общие ограничения</h2><p>READ доступ</p>"
        '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[V9 - example]]>'
        '</ac:plain-text-body></ac:structured-macro>'
    )
    versions = explicit_versions(storage_to_markdown(html))
    assert list(versions) == ["V1", "V2", "V3", "V4"]
    for revision, phrase in zip(versions, ("Базовый поиск", "Добавили расчёт", "параметр limit", "возвращаем total")):
        assert phrase in versions[revision]
        assert sum(phrase in page for page in versions.values()) == 1
    assert "Общие ограничения" not in versions["V4"]
    assert list(explicit_versions("V1 — функция; V2 — расчёт")) == ["V1", "V2"]
    no_header = storage_to_markdown("<table><tr><td>V1</td><td>Поиск</td></tr><tr><td>V2</td><td>Расчёт</td></tr></table>")
    assert list(explicit_versions(no_header)) == ["V1", "V2"]


@pytest.mark.parametrize("imported", (True, False), ids=("imported_page", "direct_link"))
def test_QA_update_adds_new_business_version_and_patches_overview(confluence, monkeypatch, imported):
    import copy
    import json
    import re
    from types import SimpleNamespace
    from agents import llm_client

    page = copy.deepcopy(PAGES["1"])
    html = (
        "<h2>Версии</h2><table><tr><th>Версия</th><th>Изменения</th></tr>"
        "<tr><td>V1</td><td>Метод GET /items</td></tr>"
        "<tr><td>V2</td><td>Расчёт total</td></tr>"
        "<tr><td>V3</td><td>Добавили параметр limit</td></tr>"
        "<tr><td>V4</td><td>Значение limit по умолчанию 20</td></tr></table>"
        "<h2>Доступ</h2><p>Только оператор.</p>"
    )
    page["body"]["storage"]["value"] = html
    monkeypatch.setitem(PAGES, "1", page)
    calls = []
    fail_patch = False

    class FakeLLM:
        def __init__(self, provider):
            pass

        def chat_continued(self, messages, **kw):
            prompt = messages[0].content
            if prompt.startswith("Ты — старший тестировщик"):
                calls.append("full")
                assert "V1, V2, V3, V4" in prompt and "Расчёт total" in prompt
                markdown = "## Доступ\nТолько оператор.\n\n## API методы\nGET /items. total рассчитан. limit: 20."
            elif prompt.startswith("Обнови только затронутые разделы"):
                calls.append("patch")
                assert "+| V5 |" in prompt and "limit по умолчанию 50" in prompt
                markdown = "не JSON" if fail_patch else json.dumps({
                    "replace": [{"index": 2, "markdown": "## API методы\nGET /items. total рассчитан. limit: 50."}],
                    "add": [],
                }, ensure_ascii=False)
            else:
                version = re.search(r"страницу изменений версии (V\d+)", prompt)[1]
                calls.append(version)
                change = prompt.split(f"ИЗМЕНЕНИЯ {version}:\n", 1)[1].split("\n\nПРЕДЫДУЩИЕ", 1)[0]
                markdown = "## Что добавили\n" + change
            return SimpleNamespace(content=markdown, finish_reason="stop")

    monkeypatch.setattr(llm_client, "LLMClient", FakeLLM)
    url = "https://c.ru/pages/viewpage.action?pageId=1"
    if imported:
        doc = asyncio.run(api.confluence_import(api.ConfluenceImport(ref=url)))["created"][0]
    else:
        doc = S.add_requirement("Поиск", "", url)
        assert api.document_links(doc["id"])["found"][0]["url"] == url
    S.update_requirement(doc["id"], qa_doc="## Старый QA", release_pages=[{"id": "V1", "markdown": "Старый V1"}])
    body = api.GenerateDocBody(provider="fake")
    first = asyncio.run(api._generate_doc(doc["id"], body, "qa"))
    assert calls == ["full", "V1", "V2", "V3", "V4"]
    assert "limit: 20" in first["qa_doc"]
    assert [p["id"] for p in first["release_pages"]] == ["V1", "V2", "V3", "V4"]
    page["version"]["number"] += 1
    page["body"]["storage"]["value"] = html.replace("</table>", "<tr><td>V5</td><td>Значение limit по умолчанию 50</td></tr></table>")
    fail_patch = True
    with pytest.raises(HTTPException, match="корректные правки"):
        asyncio.run(api._generate_doc(doc["id"], body, "qa"))
    assert S.get_requirement(doc["id"]) == first
    fail_patch = False
    second = asyncio.run(api._generate_doc(doc["id"], body, "qa"))
    assert calls == ["full", "V1", "V2", "V3", "V4", "patch", "patch", "V5"]
    assert second["qa_doc"] == first["qa_doc"].replace("limit: 20", "limit: 50")
    assert second["release_pages"][:4] == first["release_pages"]
    assert "limit по умолчанию 50" in second["release_pages"][4]["markdown"]
    assert second["version"] == first["version"] + int(imported)
    asyncio.run(api._generate_doc(doc["id"], body, "qa"))
    assert calls[-2:] == ["patch", "V5"] and calls.count("patch") == 2


def test_plantuml_renders_qa_and_repairs_previously_processed_versions(tmp_path, monkeypatch):
    import re
    import shutil
    from types import SimpleNamespace
    from xml.etree import ElementTree

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from agents import llm_client
    from agents.plantuml_render import LEGACY_DIAGRAM_ERRORS
    from backend.api.auth import require_user

    node = shutil.which("node")
    if not node:
        pytest.skip("Встроенная отрисовка использует Node.js 20+.")
    binaries = tmp_path / "bin"
    binaries.mkdir()
    (binaries / "node").symlink_to(node)
    monkeypatch.setenv("PATH", str(binaries))
    monkeypatch.setenv("PLANTUML_JAR", "/missing/old-renderer.jar")
    monkeypatch.setattr(api, "ASSETS_DIR", tmp_path / "assets")
    diagram = (
        "## Диаграммы\n\n"
        "```plantuml\n"
        "@startuml\nparticipant \"Клиент\" as A\nparticipant \"Сервис\" as B\nA -> B: Запрос\n@enduml\n```\n"
        "@startuml\ncomponent API\ncomponent Storage\nAPI --> Storage\n@enduml\n"
        "```puml\nstart\n:Проверка;\nstop\n```\n"
        "@startuml\nentity Client\nentity Request\nClient ||--o{ Request\n@enduml\n"
    )
    calls = []

    class FakeLLM:
        def __init__(self, provider):
            pass

        def chat_continued(self, messages, **kwargs):
            calls.append(messages[0].content)
            return SimpleNamespace(content=diagram, finish_reason="stop")

    monkeypatch.setattr(llm_client, "LLMClient", FakeLLM)
    req = S.add_requirement("Схемы", "", "## V1 — Запрос\nКлиент вызывает API.")
    generated = asyncio.run(api._generate_doc(req["id"], api.GenerateDocBody(provider="fake"), "qa"))
    assert len(calls) == 2
    assert not generated["qa_link_errors"]
    urls = re.findall(r"\]\((/api/requirements/assets/\w+\.svg)\)", generated["qa_doc"])
    assert len(urls) == 4
    assert all(url in generated["release_pages"][0]["markdown"] for url in urls)

    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user] = lambda: {"login": "qa"}
    with TestClient(app) as client:
        diagrams = [client.get(url) for url in urls]
        assert all(response.status_code == 200 and response.headers["content-type"] == "image/svg+xml"
                   and "default-src 'none'" in response.headers["content-security-policy"] for response in diagrams)
        assert all(ElementTree.fromstring(response.content).tag.endswith("}svg") for response in diagrams)
        assert "Клиент" in diagrams[0].text
        warning = f"> Схема 1. {LEGACY_DIAGRAM_ERRORS[0]}"
        S.update_requirement(req["id"], qa_doc=warning, qa_link_errors=[*LEGACY_DIAGRAM_ERRORS, "Исходник недоступен"],
                             release_pages=[{**generated["release_pages"][0], "markdown": f"> Схема 1. {LEGACY_DIAGRAM_ERRORS[1]}"}])
        route = f"/api/requirements/{req['id']}/render-diagrams"
        response = client.post(route).raise_for_status().json()
        assert response["qa_doc"] == generated["qa_doc"]
        assert response["release_pages"] == generated["release_pages"]
        assert response["qa_link_errors"] == ["Исходник недоступен"]
        assert len(calls) == 2
        assert client.post(route).raise_for_status().json()["updated_at"] == response["updated_at"]


def test_plantuml_requests_external_assets_are_kept_offline(tmp_path, monkeypatch):
    from agents.plantuml_render import render_markdown

    monkeypatch.setenv("PATH", str(tmp_path))
    warnings = []
    def unexpected_save(_):
        pytest.fail("External imports must not be rendered")

    markdown, warnings = render_markdown(
        "@startuml\n!includeurl https://example.invalid/page.puml\nAlice -> Bob\n@enduml", unexpected_save,
    )
    assert len(warnings) == 1 and "внешний файл" in markdown
