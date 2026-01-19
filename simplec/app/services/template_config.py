from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List
from pathlib import Path

import yaml


@dataclass
class NamingRules:
    platform_allowed: List[str]
    feature_code_pattern: str
    name_format: str


@dataclass
class StatusRules:
    fixed: str


@dataclass
class StepRules:
    expected_layers: List[str]
    expected_joiner: str


@dataclass
class ManualTemplate:
    name: str
    version: str
    required_fields: List[str]
    allowed_priorities: List[str]
    default_priority: str
    naming: NamingRules
    status: StatusRules
    step_rules: StepRules
    md_header: str
    md_case_title: str
    md_bullets: List[str]
    md_sections: Dict[str, str]


def load_manual_template(path: str = "simplec/config/test_template.yaml") -> ManualTemplate:
    p = Path(path)
    data: Dict[str, Any] = yaml.safe_load(p.read_text(encoding="utf-8"))

    tpl = data["template"]
    fields = data["fields"]
    pr = data["priority"]
    md = data["markdown"]
    naming = data["naming"]
    status = data.get("status", {"fixed": "требуется согласование"})
    step_fields = data.get("step_fields", {})
    expected_layers = step_fields.get("expected_layers", ["UI", "API", "DB", "Kafka"])
    expected_joiner = step_fields.get("expected_joiner", " ")

    return ManualTemplate(
        name=str(tpl.get("name", "Template")),
        version=str(tpl.get("version", "1.0")),
        required_fields=list(fields.get("required", [])),
        allowed_priorities=list(pr.get("allowed", ["P0", "P1", "P2", "P3"])),
        default_priority=str(pr.get("default", "P2")),
        naming=NamingRules(
            platform_allowed=list(naming.get("platform_allowed", ["W", "M"])),
            feature_code_pattern=str(naming.get("feature_code_pattern", r"^[A-Z0-9_]{2,10}$")),
            name_format=str(naming.get("name_format", "[{platform}][{feature}] {title}")),
        ),
        status=StatusRules(fixed=str(status.get("fixed", "требуется согласование"))),
        step_rules=StepRules(expected_layers=list(expected_layers), expected_joiner=str(expected_joiner)),
        md_header=str(md.get("header", "# Manual Test Cases")),
        md_case_title=str(md.get("case_title", "## {name}")),
        md_bullets=list(md.get("bullets", [])),
        md_sections=dict(md.get("sections", {})),
    )
