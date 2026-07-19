"""Local embedding service using fastembed (ONNX BGE-small).

Avoids external API calls for embeddings so retrieval is deterministic and
free. Model is lazy-loaded on first use.
"""
from __future__ import annotations

import os
import threading
from typing import List, Optional

import numpy as np


_LOCK = threading.Lock()
_MODEL = None


def _get_model():
    global _MODEL
    if _MODEL is None:
        with _LOCK:
            if _MODEL is None:
                from fastembed import TextEmbedding
                model_name = os.environ.get("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
                _MODEL = TextEmbedding(model_name=model_name)
    return _MODEL


def embed_texts(texts: List[str]) -> List[List[float]]:
    if not texts:
        return []
    model = _get_model()
    embs = list(model.embed(texts))
    return [e.tolist() for e in embs]


def embed_query(text: str) -> List[float]:
    return embed_texts([text])[0]


def cosine_similarity_matrix(query: List[float], docs: List[List[float]]) -> np.ndarray:
    if not docs:
        return np.array([])
    q = np.array(query, dtype=np.float32)
    d = np.array(docs, dtype=np.float32)
    q_norm = q / (np.linalg.norm(q) + 1e-9)
    d_norm = d / (np.linalg.norm(d, axis=1, keepdims=True) + 1e-9)
    return d_norm @ q_norm
