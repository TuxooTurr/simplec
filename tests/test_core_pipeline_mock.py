from pathlib import Path
from simplec.app.pipeline import PipelineInput, run_pipeline
import os

def test_pipeline_mock_produces_artifacts(monkeypatch):
    monkeypatch.setenv("USE_REAL_LLM", "0")
    monkeypatch.setenv("LLM_PROVIDER", "gigachat")
    out = run_pipeline(PipelineInput(text="Login must allow 2FA", platform="W", feature="AUTH"))
    assert out and out.out_dir
    out_dir = Path(out.out_dir)
    assert out_dir.is_dir()
    for name in ["normalized.json", "report.json", "manual_tests.md", "zephyr_import.json"]:
        assert (out_dir / name).exists()
