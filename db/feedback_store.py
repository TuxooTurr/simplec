"""
Хранилище фидбека по генерациям.
"""

import json
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

DB_DIR = Path(__file__).resolve().parent / "chroma_db"


class FeedbackStore:

    def __init__(self):
        self.feedback_file = DB_DIR / "feedback.json"
        self.feedback_file.parent.mkdir(parents=True, exist_ok=True)
        self._load()

    def _load(self):
        if self.feedback_file.exists():
            with open(self.feedback_file, "r", encoding="utf-8") as f:
                self.data = json.load(f)
        else:
            self.data = {"feedback": [], "stats": {"total": 0, "positive": 0, "negative": 0}}

    def _save(self):
        with open(self.feedback_file, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)

    def add_feedback(
        self,
        generation_type: str,
        rating: str,
        requirement_preview: str,
        result_preview: str,
        comment: str = "",
        platform: str = "",
        feature: str = "",
        etalons_used: int = 0,
        test_cases_count: int = 0,
        sections_count: int = 0,
    ) -> Dict:

        entry = {
            "id": "FB-" + datetime.now().strftime("%Y%m%d%H%M%S%f")[:20],
            "timestamp": datetime.now().isoformat(),
            "generation_type": generation_type,
            "rating": rating,
            "comment": comment,
            "platform": platform,
            "feature": feature,
            "etalons_used": etalons_used,
            "test_cases_count": test_cases_count,
            "sections_count": sections_count,
            "requirement_preview": requirement_preview[:500],
            "result_preview": result_preview[:500],
        }

        self.data["feedback"].append(entry)
        self.data["stats"]["total"] += 1
        if rating == "positive":
            self.data["stats"]["positive"] += 1
        else:
            self.data["stats"]["negative"] += 1

        self._save()
        return entry

    def get_stats(self) -> Dict:
        s = self.data["stats"]
        total = s["total"]
        if total == 0:
            rate = 0
        else:
            rate = round(s["positive"] / total * 100)
        return {
            "total": total,
            "positive": s["positive"],
            "negative": s["negative"],
            "approval_rate": rate,
        }

    def get_recent(self, n: int = 10) -> List[Dict]:
        return list(reversed(self.data["feedback"]))[:n]

    def get_negative_feedback(self) -> List[Dict]:
        return [
            fb for fb in self.data["feedback"]
            if fb["rating"] == "negative"
        ]

    def get_feedback_by_type(self, gen_type: str) -> Dict:
        items = [
            fb for fb in self.data["feedback"]
            if fb["generation_type"] == gen_type
        ]
        pos = sum(1 for fb in items if fb["rating"] == "positive")
        neg = sum(1 for fb in items if fb["rating"] == "negative")
        total = pos + neg
        if total == 0:
            rate = 0
        else:
            rate = round(pos / total * 100)
        return {
            "total": total,
            "positive": pos,
            "negative": neg,
            "approval_rate": rate,
        }

