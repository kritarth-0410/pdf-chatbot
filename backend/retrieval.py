"""Hybrid retrieval: dense (cosine over embeddings) + BM25 sparse, then fused
with reciprocal rank fusion.
"""
from __future__ import annotations

from typing import List, Dict, Any
import re

import numpy as np
from rank_bm25 import BM25Okapi

from embeddings import embed_query, cosine_similarity_matrix


_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def _tok(text: str) -> List[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text)]


def hybrid_search(query: str, chunks: List[Dict[str, Any]], top_k: int = 8) -> List[Dict[str, Any]]:
    """Return top_k chunks ranked with reciprocal rank fusion.

    Each chunk dict must contain at minimum: id, text, embedding.
    """
    if not chunks:
        return []

    # --- Dense scoring ---
    q_emb = embed_query(query)
    embeddings = [c.get("embedding", []) for c in chunks]
    dense_scores = cosine_similarity_matrix(q_emb, embeddings)

    # --- Sparse BM25 ---
    corpus_tokens = [_tok(c["text"]) for c in chunks]
    bm25 = BM25Okapi(corpus_tokens)
    q_tokens = _tok(query)
    sparse_scores = bm25.get_scores(q_tokens)

    dense_rank = np.argsort(-dense_scores)
    sparse_rank = np.argsort(-sparse_scores)

    # Reciprocal rank fusion
    k = 60
    rrf = np.zeros(len(chunks))
    for r, idx in enumerate(dense_rank):
        rrf[idx] += 1.0 / (k + r + 1)
    for r, idx in enumerate(sparse_rank):
        rrf[idx] += 1.0 / (k + r + 1)

    # Confidence: normalized dense score of top candidate
    order = np.argsort(-rrf)[:top_k]
    results = []
    for i in order:
        c = dict(chunks[i])
        c.pop("embedding", None)
        c["score"] = float(dense_scores[i])
        c["rrf"] = float(rrf[i])
        results.append(c)
    return results
