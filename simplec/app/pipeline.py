from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional, Dict, Any

from simplec.app.services.ingestion import ingest_from_text, ingest_from_file
from simplec.app.services.normalization import normalize_requirements
from simplec.app.services.artifacts import write_artifacts
from simplec.app.services.render_md import render_manual_md_from_zephyr_import
from simplec.core.providers import get_provider


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


def _make_report(platform: str, feature: str, normalized: Dict[str, Any], zephyr_import: Dict[str, Any], llm_meta: Dict[str, Any]) -> Dict[str, Any]:
    total = len(normalized.get("items", []))
    covered = len(zephyr_import.get("testCases", [])) if zephyr_import else 0
    ratio = (covered / total) if total else 0.0
    return {
        "context": {"platform": platform, "feature": feature},
        "requirements_total": total,
        "requirements_covered": covered,
        "coverage_ratio": ratio,
        "uncovered_reqs": [],
        "template_used": "simplec/config/test_template.yaml",
        "llm_meta": llm_meta,
    }


def run_pipeline(inp: PipelineInput) -> PipelineOutput:
    if bool(inp.text) == bool(inp.file_path):
        raise ValueError("Нужно указать ровно один источник: text ИЛИ file_path")

    raw = ingest_from_text(inp.text) if inp.text else ingest_from_file(inp.file_path)  # type: ignore[arg-type]
    normalized = normalize_requirements(raw)

    use_real = os.getenv("USE_REAL_LLM", "0") == "1"
    provider_name = os.getenv("LLM_PROVIDER", "openai").lower().strip()

    llm_meta: Dict[str, Any] = {"requested": "real" if use_real else "mock", "provider": provider_name}

    if use_real:
        try:
            provider = get_provider(provider_name, use_real=True)
            zephyr_import = provider.generate_zephyr_import(normalized, platform=inp.platform, feature=inp.feature)
            manual_md = render_manual_md_from_zephyr_import(zephyr_import)
            report = _make_report(inp.platform, inp.feature, normalized, zephyr_import, {**llm_meta, "mode": "real"})
        except Exception as e:
            mock_provider = get_provider("mock", use_real=False)
            zephyr_import = mock_provider.generate_zephyr_import(normalized, platform=inp.platform, feature=inp.feature)
            manual_md = render_manual_md_from_zephyr_import(zephyr_import)
            report = _make_report(
                inp.platform, inp.feature, normalized, zephyr_import,
                {**llm_meta, "mode": "mock_fallback", "error": f"{type(e).__name__}: {e}"}
            )
    else:
        mock_provider = get_provider("mock", use_real=False)
        zephyr_import = mock_provider.generate_zephyr_import(normalized, platform=inp.platform, feature=inp.feature)
        manual_md = render_manual_md_from_zephyr_import(zephyr_import)
        report = _make_report(inp.platform, inp.feature, normalized, zephyr_import, {**llm_meta, "mode": "mock"})

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
