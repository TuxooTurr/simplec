from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional, Dict, Any

from simplec.app.services.ingestion import ingest_from_text, ingest_from_file
from simplec.app.services.normalization import normalize_requirements
from simplec.app.services.llm_mock import generate_manual_tests_mock
from simplec.app.services.artifacts import write_artifacts
from simplec.app.services.render_md import render_manual_md_from_zephyr_import


@dataclass
class PipelineInput:
    text: Optional[str] = None
    file_path: Optional[str] = None
    platform: str = "W"
    feature: str = "GEN"
    feature_name: str | None = None


@dataclass
class PipelineOutput:
    normalized: Dict[str, Any]
    manual_tests_md: str
    report: Dict[str, Any]
    zephyr_import: Dict[str, Any] | None
    out_dir: str


def run_pipeline(inp: PipelineInput) -> PipelineOutput:
    if bool(inp.text) == bool(inp.file_path):
        raise ValueError("Нужно указать ровно один источник: text ИЛИ file_path")

    raw = ingest_from_text(inp.text) if inp.text else ingest_from_file(inp.file_path)  # type: ignore[arg-type]
    normalized = normalize_requirements(raw)

    use_real = os.getenv("USE_REAL_LLM", "0") == "1"
    provider = os.getenv("LLM_PROVIDER", "openai").lower().strip()

    llm_meta: Dict[str, Any] = {"requested": "real" if use_real else "mock", "provider": provider}

    if use_real:
        try:
            if provider == "gigachat":
                from simplec.app.services.llm_gigachat import generate_zephyr_import_gigachat
                zephyr_import = generate_zephyr_import_gigachat(normalized, platform=inp.platform, feature=inp.feature)
            elif provider == "openai":
                from simplec.app.services.llm_openai import generate_zephyr_import_openai
                zephyr_import = generate_zephyr_import_openai(normalized, platform=inp.platform, feature=inp.feature)
            else:
                raise ValueError(f"Неизвестный LLM_PROVIDER: {provider}")

            manual_md = render_manual_md_from_zephyr_import(zephyr_import)

            report = {
                "context": {"platform": inp.platform, "feature": inp.feature},
                "requirements_total": len(normalized.get("items", [])),
                "requirements_covered": len(zephyr_import.get("testCases", [])),
                "coverage_ratio": (
                    len(zephyr_import.get("testCases", [])) / len(normalized.get("items", []))
                    if normalized.get("items") else 0.0
                ),
                "uncovered_reqs": [],
                "template_used": "simplec/config/test_template.yaml",
                "llm_meta": {**llm_meta, "mode": "real"},
            }
        except Exception as e:
            llm_out = generate_manual_tests_mock(normalized, platform=inp.platform, feature=inp.feature)
            manual_md = llm_out["manual_tests_md"]
            report = llm_out["report"]
            report["llm_meta"] = {**llm_meta, "mode": "mock_fallback", "error": f"{type(e).__name__}: {e}"}
            zephyr_import = llm_out.get("zephyr_import")
    else:
        llm_out = generate_manual_tests_mock(normalized, platform=inp.platform, feature=inp.feature)
        manual_md = llm_out["manual_tests_md"]
        report = llm_out["report"]
        report["llm_meta"] = {**llm_meta, "mode": "mock"}
        zephyr_import = llm_out.get("zephyr_import")

    out_dir = write_artifacts(
        manual_md=manual_md,
        report=report,
        normalized=normalized,
        zephyr_import=zephyr_import,
    )

    return PipelineOutput(
        normalized=normalized,
        manual_tests_md=manual_md,
        report=report,
        zephyr_import=zephyr_import,
        out_dir=out_dir,
    )
