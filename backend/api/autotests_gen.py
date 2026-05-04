"""
Генерация автотестов по ручным тест-кейсам через LLM.
Поддерживаемые типы: api, e2e, frontend, mobile, dt (desktop).
"""
import asyncio
import os
import re
from pathlib import Path
from fastapi import APIRouter, Form, HTTPException
from pydantic import BaseModel

router = APIRouter()

# ── Промпты по типам ──────────────────────────────────────────────────────────

_PROMPTS: dict[str, str] = {

    "api": """\
Ты ведущий QA-автоматизатор. Преобразуй ручные тест-кейсы в Java-класс для тестирования REST API.

Требования к коду:
- Фреймворк: JUnit 5 + RestAssured
- В начале файла — блок комментариев с зависимостями (Maven):
  // === ЗАВИСИМОСТИ (pom.xml) ===
  // <dependency> io.rest-assured:rest-assured:5.3.2 </dependency>
  // <dependency> org.junit.jupiter:junit-jupiter:5.10.2 </dependency>
  // <dependency> com.fasterxml.jackson.core:jackson-databind:2.17.0 </dependency>
- Один публичный класс (имя по фиче или «GeneratedApiTests»)
- Каждый тест-кейс → отдельный метод с @Test и @DisplayName на русском
- Шаги → цепочки RestAssured: given() / .header() / .body() / .when() / .get|post|put|delete() / .then() / .statusCode() / .body()
- Рядом с каждым вызовом RestAssured — комментарий: // Зависимость: RestAssured
- Используй BASE_URI как константу класса; если URL в кейсе не указан — подставь "http://localhost:8080"
- Только валидный Java-код, без объяснений и markdown-блоков.

ВХОДНЫЕ ТЕСТ-КЕЙСЫ:
{cases}""",

    "e2e": """\
Ты ведущий QA-автоматизатор. Преобразуй ручные тест-кейсы в Java-класс для сквозного E2E-тестирования.

Требования к коду:
- Фреймворк: JUnit 5 + Selenide
- В начале файла — блок комментариев с зависимостями (Maven):
  // === ЗАВИСИМОСТИ (pom.xml) ===
  // <dependency> com.codeborne:selenide:7.2.2 </dependency>
  // <dependency> org.junit.jupiter:junit-jupiter:5.10.2 </dependency>
- Один публичный класс (имя по фиче или «GeneratedE2ETests»)
- @ExtendWith(SelenideExtension.class) на класс
- Каждый тест-кейс → отдельный метод с @Test и @DisplayName на русском
- Шаги → методы Selenide: open(), $(selector), .click(), .setValue(), .shouldBe(Condition.visible) и т.п.
- Рядом с каждым Selenide-вызовом — комментарий: // Зависимость: Selenide
- Если URL не указан — open("/") как заглушка
- Только валидный Java-код, без объяснений и markdown-блоков.

ВХОДНЫЕ ТЕСТ-КЕЙСЫ:
{cases}""",

    "frontend": """\
Ты ведущий QA-автоматизатор. Преобразуй ручные тест-кейсы в Java-класс для тестирования веб-интерфейса (Frontend UI).

Требования к коду:
- Фреймворк: JUnit 5 + Selenide
- В начале файла — блок комментариев с зависимостями (Maven):
  // === ЗАВИСИМОСТИ (pom.xml) ===
  // <dependency> com.codeborne:selenide:7.2.2 </dependency>
  // <dependency> org.junit.jupiter:junit-jupiter:5.10.2 </dependency>
- Один публичный класс (имя по фиче или «GeneratedFrontendTests»)
- @ExtendWith(SelenideExtension.class) на класс
- Каждый тест-кейс → отдельный метод с @Test и @DisplayName на русском
- Фокус на проверке UI-элементов: видимость, текст, состояние, CSS-классы
- Шаги → $(), $$(), .shouldBe(), .shouldHave(text()), .shouldNotBe(), .getAttribute()
- Рядом с каждым Selenide-вызовом — комментарий: // Зависимость: Selenide
- Если URL не указан — open("/") как заглушка
- Только валидный Java-код, без объяснений и markdown-блоков.

ВХОДНЫЕ ТЕСТ-КЕЙСЫ:
{cases}""",

    "mobile": """\
Ты ведущий QA-автоматизатор. Преобразуй ручные тест-кейсы в Java-класс для мобильного тестирования.

Требования к коду:
- Фреймворк: JUnit 5 + Appium (Java Client 9.x)
- В начале файла — блок комментариев с зависимостями (Maven):
  // === ЗАВИСИМОСТИ (pom.xml) ===
  // <dependency> io.appium:java-client:9.1.0 </dependency>
  // <dependency> org.junit.jupiter:junit-jupiter:5.10.2 </dependency>
  // <dependency> io.github.bonigarcia:webdrivermanager:5.8.0 </dependency>
- Один публичный класс (имя по фиче или «GeneratedMobileTests»)
- @BeforeEach — инициализация AppiumDriver (AndroidDriver или IOSDriver) через DesiredCapabilities / UiAutomator2Options
- @AfterEach — driver.quit()
- Каждый тест-кейс → метод с @Test и @DisplayName на русском
- Шаги → driver.findElement(By.id/xpath/accessibilityId()), .click(), .sendKeys(), .getText(), new TouchAction() для жестов
- Рядом с каждым Appium-вызовом — комментарий: // Зависимость: Appium java-client
- Только валидный Java-код, без объяснений и markdown-блоков.

ВХОДНЫЕ ТЕСТ-КЕЙСЫ:
{cases}""",

    "dt": """\
Ты ведущий QA-автоматизатор. Преобразуй ручные тест-кейсы в Java-класс для тестирования десктопного приложения.

Требования к коду:
- Фреймворк: JUnit 5 + Appium (WinAppDriver / UiAutomation2)
- В начале файла — блок комментариев с зависимостями (Maven):
  // === ЗАВИСИМОСТИ (pom.xml) ===
  // <dependency> io.appium:java-client:9.1.0 </dependency>
  // <dependency> org.junit.jupiter:junit-jupiter:5.10.2 </dependency>
  // Требуется: WinAppDriver v1.2+ (https://github.com/microsoft/WinAppDriver)
- Один публичный класс (имя по фиче или «GeneratedDesktopTests»)
- @BeforeEach — инициализация WindowsDriver через AppiumOptions с app-capability (путь к .exe или "Root")
- @AfterEach — driver.quit()
- Каждый тест-кейс → метод с @Test и @DisplayName на русском
- Шаги → driver.findElement(By.name/id/xpath/className()), .click(), .sendKeys(), .getText(), Actions для hotkeys
- Рядом с каждым WinAppDriver-вызовом — комментарий: // Зависимость: WinAppDriver + Appium java-client
- Только валидный Java-код, без объяснений и markdown-блоков.

ВХОДНЫЕ ТЕСТ-КЕЙСЫ:
{cases}""",
}

_DEFAULT_TYPE = "e2e"


def _generate_sync(cases: str, provider: str, test_type: str,
                   project_context: str = "") -> str:
    from agents.llm_client import LLMClient, Message

    prompt_tpl = _PROMPTS.get(test_type, _PROMPTS[_DEFAULT_TYPE])
    # Use replace instead of .format() to avoid KeyError on curly braces in input
    prompt = prompt_tpl.replace("{cases}", cases)

    if project_context:
        project_block = (
            "\n\nКОНТЕКСТ ПРОЕКТА (используй эти зависимости и структуру пакетов):\n"
            + project_context
        )
        # Insert project context before the cases block
        prompt = prompt.replace("\nВХОДНЫЕ ТЕСТ-КЕЙСЫ:", project_block + "\n\nВХОДНЫЕ ТЕСТ-КЕЙСЫ:")

    llm = LLMClient(provider=provider)
    resp = llm.chat(
        [Message(role="user", content=prompt)],
        temperature=0.2,
        max_tokens=4000,
    )
    return resp.content.strip()


@router.post("/api/autotests/generate")
async def generate_autotest(
    cases:           str = Form(...),
    feature:         str = Form(""),
    provider:        str = Form(...),
    test_type:       str = Form("e2e"),
    project_context: str = Form(""),
):
    """Принимает ручные тест-кейсы и возвращает код автотеста.
    test_type: api | e2e | frontend | mobile | dt
    project_context: JSON-строка с данными проекта (deps, packages, структура)
    """
    provider = provider.strip()
    if not provider:
        raise HTTPException(
            status_code=400,
            detail={"message": "LLM-провайдер не выбран", "llm_error": False},
        )

    try:
        code = await asyncio.to_thread(
            _generate_sync, cases, provider, test_type, project_context
        )
        return {"code": code}
    except Exception as e:
        from agents.llm_client import LLMClient
        is_llm, msg = LLMClient.classify_error(e)
        raise HTTPException(
            status_code=503 if is_llm else 500,
            detail={"message": msg, "llm_error": is_llm},
        )


# ── Project analysis ──────────────────────────────────────────────────────────

class AnalyzeProjectRequest(BaseModel):
    path: str


def _analyze_project_sync(project_path: str) -> dict:
    """
    Сканирует Java/Maven/Gradle проект и возвращает контекст:
    - build_tool: maven | gradle | unknown
    - dependencies: список строк "<groupId>:<artifactId>:<version>"
    - base_packages: уникальные корневые пакеты из src/test/java
    - test_dirs: найденные директории с тестами
    - sample_imports: до 30 уникальных import-строк из тестовых файлов
    """
    root = Path(project_path).expanduser().resolve()
    if not root.exists():
        raise ValueError(f"Путь не найден: {project_path}")
    if not root.is_dir():
        raise ValueError(f"Указан файл, а не директория: {project_path}")

    result: dict = {
        "build_tool": "unknown",
        "dependencies": [],
        "base_packages": [],
        "test_dirs": [],
        "sample_imports": [],
    }

    # ── Detect build tool & parse deps ───────────────────────────────────────

    pom = root / "pom.xml"
    gradle_groovy = root / "build.gradle"
    gradle_kts    = root / "build.gradle.kts"

    if pom.exists():
        result["build_tool"] = "maven"
        try:
            text = pom.read_text(encoding="utf-8", errors="replace")
            # Extract <groupId>:<artifactId>:<version> blocks
            deps = re.findall(
                r"<dependency>\s*<groupId>(.*?)</groupId>\s*<artifactId>(.*?)</artifactId>"
                r"(?:\s*<version>(.*?)</version>)?",
                text, re.DOTALL
            )
            result["dependencies"] = [
                f"{g.strip()}:{a.strip()}" + (f":{v.strip()}" if v.strip() else "")
                for g, a, v in deps
            ][:40]
        except Exception:
            pass

    elif gradle_groovy.exists() or gradle_kts.exists():
        result["build_tool"] = "gradle"
        gradle_file = gradle_groovy if gradle_groovy.exists() else gradle_kts
        try:
            text = gradle_file.read_text(encoding="utf-8", errors="replace")
            # Extract implementation/testImplementation '...' or "..."
            deps = re.findall(
                r'(?:implementation|testImplementation|testRuntimeOnly|compile)'
                r"""\s+['"]([\w.\-]+:[\w.\-]+(?::[\w.\-]+)?)['"]\s""",
                text
            )
            result["dependencies"] = list(dict.fromkeys(deps))[:40]
        except Exception:
            pass

    # ── Find test directories ─────────────────────────────────────────────────

    test_dirs_candidates = [
        root / "src" / "test" / "java",
        root / "src" / "test" / "kotlin",
        root / "src" / "androidTest" / "java",
        root / "tests",
        root / "test",
    ]
    found_dirs = [str(d.relative_to(root)) for d in test_dirs_candidates if d.exists()]
    result["test_dirs"] = found_dirs

    # ── Scan Java/Kotlin test files for packages and imports ──────────────────

    java_roots = [d for d in test_dirs_candidates if d.exists()]
    if not java_roots:
        # Fallback: scan whole project for *Test*.java
        java_roots = [root]

    packages: set[str] = set()
    imports:  set[str] = set()
    files_scanned = 0

    for java_root in java_roots:
        for fpath in java_root.rglob("*.java"):
            if files_scanned >= 60:
                break
            try:
                content = fpath.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            files_scanned += 1

            pkg_match = re.search(r"^package\s+([\w.]+)\s*;", content, re.MULTILINE)
            if pkg_match:
                pkg = pkg_match.group(1)
                # Keep only root package (first 2-3 segments)
                parts = pkg.split(".")
                packages.add(".".join(parts[:3]))

            for imp in re.findall(r"^import\s+([\w.*]+)\s*;", content, re.MULTILINE):
                if not imp.startswith("java."):
                    imports.add(imp)

    result["base_packages"] = sorted(packages)[:10]
    result["sample_imports"] = sorted(imports)[:30]
    return result


@router.post("/api/autotests/analyze-project")
async def analyze_project(req: AnalyzeProjectRequest):
    """
    Анализирует структуру Java-проекта по заданному пути.
    Возвращает: build_tool, dependencies, base_packages, test_dirs, sample_imports.
    """
    try:
        data = await asyncio.to_thread(_analyze_project_sync, req.path)
        return data
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка анализа проекта: {e}")
