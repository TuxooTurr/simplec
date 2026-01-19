from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Form, Request, UploadFile, File
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.templating import Jinja2Templates

from simplec.app.pipeline import PipelineInput, run_pipeline


BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"

app = FastAPI(title="SimpleC MVP")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    # дефолты для формы (все подписи на русском, но значения — короткие коды)
    form = {
        "platform": os.getenv("DEFAULT_PLATFORM", "W"),
        "feature": os.getenv("DEFAULT_FEATURE", ""),
        "llm_provider": os.getenv("LLM_PROVIDER", "gigachat"),
        "use_real_llm": os.getenv("USE_REAL_LLM", "1"),
        "text": "",
    }
    return templates.TemplateResponse("index.html", {"request": request, "result": None, "error": None, "form": form})


@app.post("/generate", response_class=HTMLResponse)
async def generate(
    request: Request,
    platform: str = Form("W"),
    feature: str = Form("AUTH"),
    use_real_llm: str = Form("1"),
    llm_provider: str = Form("gigachat"),
    text: str = Form(""),
    file: Optional[UploadFile] = File(None),
):
    form_state = {
        "platform": platform,
        "feature": feature,
        "use_real_llm": use_real_llm,
        "llm_provider": llm_provider,
        "text": text,
    }

    # Настройки провайдера
    if llm_provider == "mock":
        os.environ["USE_REAL_LLM"] = "0"
        os.environ["LLM_PROVIDER"] = "gigachat"
    else:
        os.environ["USE_REAL_LLM"] = "1" if use_real_llm == "1" else "0"
        os.environ["LLM_PROVIDER"] = llm_provider

    try:
        # источник: файл приоритетнее текста
        if file and file.filename:
            b = await file.read()
            req_text = b.decode("utf-8", errors="replace")
        else:
            req_text = text

        if not (req_text or "").strip():
            raise ValueError("Нужно вставить требования в поле «Требования (текст)» или загрузить файл.")

        out = run_pipeline(PipelineInput(text=req_text, platform=platform.strip(), feature=feature.strip()))

        result = {
            "out_dir": out.out_dir,
            "zephyr_json": json.dumps(out.zephyr_import, ensure_ascii=False, indent=2) if out.zephyr_import else "",
        }

        return templates.TemplateResponse("index.html", {"request": request, "result": result, "error": None, "form": form_state})
    except Exception as e:
        return templates.TemplateResponse(
            "index.html",
            {"request": request, "result": None, "error": f"{type(e).__name__}: {e}", "form": form_state},
        )


@app.get("/download/zephyr")
def download_zephyr(out_dir: str):
    path = Path(out_dir) / "zephyr_import.json"
    if not path.is_file():
        return PlainTextResponse("Not found", status_code=404)
    content = path.read_text(encoding="utf-8")
    return PlainTextResponse(
        content,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="zephyr_import.json"'},
    )
