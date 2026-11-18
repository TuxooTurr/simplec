"""Opt-in end-to-end check for an event from a known operation on IFT."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime

import pytest

from agents.log_assertions import LogFilter, wait_for_logs
from db.paths import MOCK

pytestmark = pytest.mark.skipif(os.getenv("PVS_SMOKE") != "1", reason="Требуется доступ к PVS на ИФТ")


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        pytest.fail(f"Задайте {name} по инструкции docs/pvs-mcp.md.")
    return value


def test_pvs_finds_known_ift_event():
    assert not MOCK and os.getenv("LOGS_MCP_PROFILE") == "pvs", "Для проверки ИФТ включите профиль pvs и выключите SHARK_MOCK."
    start = datetime.fromisoformat(_required("PVS_SMOKE_FROM").replace("Z", "+00:00"))
    end = datetime.fromisoformat(_required("PVS_SMOKE_TO").replace("Z", "+00:00"))
    result = asyncio.run(wait_for_logs(
        start,
        end,
        LogFilter(namespace="sber911-sigma-back", service=os.getenv("PVS_SMOKE_SERVICE") or None,
                  text=_required("PVS_SMOKE_EXPECTED_TEXT"), request_id=os.getenv("PVS_SMOKE_REQUEST_ID", ""),
                  trace_id=os.getenv("PVS_SMOKE_TRACE_ID", "")),
        timeout=float(os.getenv("PVS_SMOKE_TIMEOUT", "45")),
    ))
    assert result.records
