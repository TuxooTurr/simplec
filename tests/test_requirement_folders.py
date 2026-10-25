"""Дерево папок «Данных»: папки, документы в них, перенос, удаление; раздел речи в промте QA-документа."""

import pytest
from fastapi import HTTPException

import db.requirements_store as rs
from backend.api import requirements as api
from db.requirements_store import RequirementsStore as S


@pytest.fixture(autouse=True)
def files(tmp_path, monkeypatch):
    monkeypatch.setattr(rs, "_FILE", tmp_path / "requirements.json")
    monkeypatch.setattr(rs, "_FOLDERS", tmp_path / "requirement_folders.json")


def _doc(name: str, folder: str = "") -> dict:
    return api.add_requirement(api.AddRequirementBody(name=name, text="Текст", folder_id=folder))


def test_вложенные_папки_и_документ_в_папке():
    top = api.add_folder(api.FolderBody(name="  Релиз 26 "))
    sub = api.add_folder(api.FolderBody(name="Карточка", parent_id=top["id"]))
    d = _doc("ТЗ карточки", sub["id"])
    assert (top["name"], sub["parent_id"], d["folder_id"]) == ("Релиз 26", top["id"], sub["id"])
    assert [f["name"] for f in api.list_folders()] == ["Карточка", "Релиз 26"]
    with pytest.raises(HTTPException) as e:
        api.add_folder(api.FolderBody(name="X", parent_id="нет"))
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        _doc("Y", "нет")
    assert e.value.status_code == 404


def test_перенос_папки_не_в_себя_и_не_во_вложенную():
    a = api.add_folder(api.FolderBody(name="A"))
    b = api.add_folder(api.FolderBody(name="B", parent_id=a["id"]))
    for target in (a["id"], b["id"]):
        with pytest.raises(HTTPException) as e:
            api.update_folder(a["id"], api.FolderPatch(parent_id=target))
        assert e.value.status_code == 422
    moved = api.update_folder(b["id"], api.FolderPatch(parent_id="", name="B2"))
    assert (moved["parent_id"], moved["name"]) == ("", "B2")


def test_удаление_папки_документы_уходят_уровнем_выше():
    a = api.add_folder(api.FolderBody(name="A"))
    b = api.add_folder(api.FolderBody(name="B", parent_id=a["id"]))
    c = api.add_folder(api.FolderBody(name="C", parent_id=b["id"]))
    d1, d2 = _doc("в B", b["id"]), _doc("в C", c["id"])
    assert api.delete_folder(b["id"]) == {"status": "deleted", "moved": 2}
    assert [f["id"] for f in api.list_folders()] == [a["id"]]
    assert {S.get_requirement(d)["folder_id"] for d in (d1["id"], d2["id"])} == {a["id"]}
    with pytest.raises(HTTPException):
        api.delete_folder(b["id"])


def test_правка_документа_заголовок_исходник_папка():
    f = api.add_folder(api.FolderBody(name="F"))
    d = _doc("Старое")
    S.update_requirement(d["id"], qa_doc="# QA")
    got = api.update_requirement(d["id"], api.RequirementPatch(name=" Новое ", text="## Исходник", folder_id=f["id"]))
    assert (got["name"], got["text"], got["folder_id"], got["qa_doc"]) == ("Новое", "## Исходник", f["id"], "# QA")
    for patch, code in ((api.RequirementPatch(name="   "), 422), (api.RequirementPatch(), 422),
                        (api.RequirementPatch(folder_id="нет"), 404)):
        with pytest.raises(HTTPException) as e:
            api.update_requirement(d["id"], patch)
        assert e.value.status_code == code


def test_раздел_речи_только_по_флагу():
    from agents.layered_generator import LayeredGenerator, SPEECH_HEADING

    class FakeLLM:
        prompt = ""

        def chat_continued(self, messages, **kwargs):
            FakeLLM.prompt = messages[0].content

            class R:
                content, finish_reason = "# Док", "stop"
            return R()

    gen = LayeredGenerator(FakeLLM())
    gen.generate_qa_doc("Требование", "Фича")
    assert SPEECH_HEADING not in FakeLLM.prompt
    gen.generate_qa_doc("Требование", "Фича", with_speech=True)
    head = FakeLLM.prompt.index("## " + SPEECH_HEADING)
    assert head > FakeLLM.prompt.index("## Вопросы для уточнения")


def _paths() -> list[str]:
    """Папки дерева полными путями «/А/Б»."""
    items = {f["id"]: f for f in api.list_folders()}
    def path(f: dict) -> str:
        p = items.get(f.get("parent_id", ""))
        return (path(p) if p else "") + "/" + f["name"]
    return sorted(path(f) for f in items.values())


def test_базовое_дерево_дописывается_один_раз(tmp_path, monkeypatch):
    mine = api.add_folder(api.FolderBody(name="Блок"))          # своя папка была до базового дерева
    base = tmp_path / "base.json"
    base.write_text('["/Блок/Раздел/Фича", "/Блок/Раздел/Фича 2"]', encoding="utf-8")
    monkeypatch.setattr(rs, "_FOLDERS_DEFAULT", base)
    assert _paths() == ["/Блок", "/Блок/Раздел", "/Блок/Раздел/Фича", "/Блок/Раздел/Фича 2"]
    assert [f["id"] for f in api.list_folders() if f["name"] == "Блок"] == [mine["id"]]
    gone = next(f for f in api.list_folders() if f["name"] == "Фича 2")
    api.delete_folder(gone["id"])
    assert "/Блок/Раздел/Фича 2" not in _paths()              # удалённая руками не возвращается
    base.write_text('["/Блок/Раздел/Фича", "/Блок/Раздел/Фича 2", "/Новый блок"]', encoding="utf-8")
    assert _paths() == ["/Блок", "/Блок/Раздел", "/Блок/Раздел/Фича", "/Новый блок"]   # новое в базовом — дописано


def test_битый_файл_папок_базовым_деревом_не_затирается(tmp_path, monkeypatch):
    base = tmp_path / "base.json"
    base.write_text('["/Блок"]', encoding="utf-8")
    monkeypatch.setattr(rs, "_FOLDERS_DEFAULT", base)
    rs._FOLDERS.write_text("{не json", encoding="utf-8")
    assert api.list_folders() == []
    assert rs._FOLDERS.read_text(encoding="utf-8") == "{не json"
