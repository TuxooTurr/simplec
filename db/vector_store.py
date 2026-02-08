"""
Векторная БД для хранения эталонов.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional, List, Dict, Any

import chromadb
from chromadb.utils import embedding_functions


DB_DIR = Path(__file__).resolve().parent
CHROMA_DIR = DB_DIR / "chroma_data"


def _build_where(platform: str = "", feature: str = "") -> Optional[Dict]:
    conditions = []
    if platform:
        conditions.append({"platform": platform})
    if feature:
        conditions.append({"feature": feature})
    if not conditions:
        return None
    if len(conditions) == 1:
        return conditions[0]
    return {"$and": conditions}


class VectorStore:

    def __init__(self, persist_dir: Optional[Path] = None):
        self.persist_dir = str(persist_dir or CHROMA_DIR)
        self.client = chromadb.PersistentClient(path=self.persist_dir)
        self.ef = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name="paraphrase-multilingual-MiniLM-L12-v2"
        )
        self._init_collections()

    def _init_collections(self):
        self.requirements = self.client.get_or_create_collection(
            name="requirements",
            metadata={"description": "Эталонные требования к ПО"},
            embedding_function=self.ef
        )
        self.test_cases = self.client.get_or_create_collection(
            name="test_cases",
            metadata={"description": "Эталонные тест-кейсы"},
            embedding_function=self.ef
        )
        self.pairs = self.client.get_or_create_collection(
            name="requirement_test_pairs",
            metadata={"description": "Пары требование-тест для обучения"},
            embedding_function=self.ef
        )

    def add_requirement(self, req_id: str, content: str, platform: str = "",
                        feature: str = "", content_type: str = "text",
                        tags: List[str] = None, extra_metadata: Dict[str, Any] = None):
        metadata = {
            "platform": platform,
            "feature": feature,
            "content_type": content_type,
            "tags": json.dumps(tags or [], ensure_ascii=False),
        }
        if extra_metadata:
            metadata.update(extra_metadata)
        self.requirements.upsert(ids=[req_id], documents=[content], metadatas=[metadata])

    def find_similar_requirements(self, query: str, n_results: int = 5,
                                   platform: str = "", feature: str = "") -> List[Dict]:
        results = self.requirements.query(
            query_texts=[query], n_results=n_results,
            where=_build_where(platform, feature)
        )
        return self._format_results(results)

    def add_test_case(self, tc_id: str, content: str, name: str = "",
                      platform: str = "", feature: str = "", priority: str = "medium",
                      element_type: str = "test_case", tags: List[str] = None,
                      extra_metadata: Dict[str, Any] = None):
        metadata = {
            "name": name, "platform": platform, "feature": feature,
            "priority": priority, "element_type": element_type,
            "tags": json.dumps(tags or [], ensure_ascii=False),
        }
        if extra_metadata:
            metadata.update(extra_metadata)
        self.test_cases.upsert(ids=[tc_id], documents=[content], metadatas=[metadata])

    def find_similar_test_cases(self, query: str, n_results: int = 5,
                                 platform: str = "", feature: str = "") -> List[Dict]:
        results = self.test_cases.query(
            query_texts=[query], n_results=n_results,
            where=_build_where(platform, feature)
        )
        return self._format_results(results)

    def add_pair(self, pair_id: str, requirement_text: str, test_case_xml: str,
                 platform: str = "", feature: str = "", tags: List[str] = None):
        metadata = {
            "test_case_xml": test_case_xml,
            "platform": platform,
            "feature": feature,
            "tags": json.dumps(tags or [], ensure_ascii=False),
        }
        self.pairs.upsert(ids=[pair_id], documents=[requirement_text], metadatas=[metadata])

    def find_similar_pairs(self, query: str, n_results: int = 3,
                            platform: str = "", feature: str = "") -> List[Dict]:
        results = self.pairs.query(
            query_texts=[query], n_results=n_results,
            where=_build_where(platform, feature)
        )
        return self._format_results(results)

    def _format_results(self, results) -> List[Dict]:
        formatted = []
        if not results or not results["ids"] or not results["ids"][0]:
            return formatted
        for i in range(len(results["ids"][0])):
            item = {
                "id": results["ids"][0][i],
                "document": results["documents"][0][i],
                "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                "distance": results["distances"][0][i] if results["distances"] else None,
            }
            formatted.append(item)
        return formatted

    def get_stats(self) -> Dict[str, int]:
        return {
            "requirements": self.requirements.count(),
            "test_cases": self.test_cases.count(),
            "pairs": self.pairs.count(),
        }

    def add_requirement(self, req_id, text, metadata=None):
        if metadata is None:
            metadata = {}
        clean_meta = {}
        for k, v in metadata.items():
            if isinstance(v, bool):
                clean_meta[k] = str(v)
            elif isinstance(v, (str, int, float)):
                clean_meta[k] = v
        self.requirements.add(
            ids=[req_id],
            documents=[text],
            metadatas=[clean_meta],
        )

    def add_pair(self, pair_id, requirement_text, test_case_xml, metadata=None):
        if metadata is None:
            metadata = {}
        clean_meta = {}
        for k, v in metadata.items():
            if isinstance(v, bool):
                clean_meta[k] = str(v)
            elif isinstance(v, (str, int, float)):
                clean_meta[k] = v
        clean_meta["test_case_xml"] = test_case_xml[:5000]
        self.pairs.add(
            ids=[pair_id],
            documents=[requirement_text],
            metadatas=[clean_meta],
        )

    def clear_all(self):
        self.client.delete_collection("requirements")
        self.client.delete_collection("test_cases")
        self.client.delete_collection("requirement_test_pairs")
        self._init_collections()

