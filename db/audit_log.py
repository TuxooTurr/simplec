"""
Аудит-лог действий пользователей.
"""

import json
import logging
from pathlib import Path
from datetime import datetime

LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("simplec_audit")
handler = logging.FileHandler(LOG_DIR / "audit.log", encoding="utf-8")
handler.setFormatter(
    logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
)
logger.addHandler(handler)
logger.setLevel(logging.INFO)


class AuditLog:

    @staticmethod
    def log_generation(
        gen_type: str,
        platform: str,
        feature: str,
        input_size: int,
        output_size: int,
        etalons_used: int = 0,
        test_cases_count: int = 0,
        duration_sec: float = 0,
        success: bool = True,
        error: str = "",
    ):
        entry = {
            "event": "generation",
            "timestamp": datetime.now().isoformat(),
            "type": gen_type,
            "platform": platform,
            "feature": feature,
            "input_size": input_size,
            "output_size": output_size,
            "etalons_used": etalons_used,
            "test_cases_count": test_cases_count,
            "duration_sec": round(duration_sec, 2),
            "success": success,
            "error": error,
        }
        logger.info(json.dumps(entry, ensure_ascii=False))

    @staticmethod
    def log_file_upload(filename: str, size: int, success: bool = True):
        entry = {
            "event": "file_upload",
            "timestamp": datetime.now().isoformat(),
            "filename": filename,
            "size": size,
            "success": success,
        }
        logger.info(json.dumps(entry, ensure_ascii=False))

    @staticmethod
    def log_feedback(
        gen_type: str, rating: str, comment: str = ""
    ):
        entry = {
            "event": "feedback",
            "timestamp": datetime.now().isoformat(),
            "type": gen_type,
            "rating": rating,
            "has_comment": bool(comment),
        }
        logger.info(json.dumps(entry, ensure_ascii=False))

    @staticmethod
    def log_db_enrichment(req_id: str, pair_id: str = ""):
        entry = {
            "event": "db_enrichment",
            "timestamp": datetime.now().isoformat(),
            "requirement_id": req_id,
            "pair_id": pair_id,
        }
        logger.info(json.dumps(entry, ensure_ascii=False))

    @staticmethod
    def log_security_event(event_type: str, details: str = ""):
        entry = {
            "event": "security",
            "timestamp": datetime.now().isoformat(),
            "type": event_type,
            "details": details,
        }
        logger.warning(json.dumps(entry, ensure_ascii=False))


