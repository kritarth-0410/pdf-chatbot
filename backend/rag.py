"""RAG orchestration: retrieve chunks -> build grounded prompt -> stream from LLM.
"""
from __future__ import annotations

import os
from typing import AsyncGenerator, List, Dict, Any, Tuple

from openai import AsyncOpenAI

from retrieval import hybrid_search


SYSTEM_PROMPT = (
    "You are DocuMind, a rigorous research assistant that answers questions "
    "using only the provided PDF context. Rules:\n"
    "1) Ground every claim in the sources. Cite them inline as [Doc:PAGE] "
    "(e.g. [contract.pdf:4]).\n"
    "2) If the context does not contain the answer, reply exactly: "
    "'I couldn't find this information inside your uploaded documents.'\n"
    "3) Be concise, structured, and neutral. Use short paragraphs and lists "
    "where useful. Preserve tables as markdown when present.\n"
    "4) Never invent page numbers, quotes, or citations."
)


def build_context_block(retrieved: List[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]]]:
    """Compose the context sent to the model + a citation manifest."""
    lines = []
    citations = []
    for i, r in enumerate(retrieved, start=1):
        pdf_name = r.get("pdf_name", "document")
        page = r.get("page", 1)
        snippet = r["text"].strip().replace("\n", " ")
        snippet_short = snippet[:280] + ("…" if len(snippet) > 280 else "")
        lines.append(f"[#{i}] Source: {pdf_name} — page {page}\n{r['text']}\n")
        citations.append({
            "pdf_id": r["pdf_id"],
            "pdf_name": pdf_name,
            "page": page,
            "snippet": snippet_short,
            "score": r.get("score", 0.0),
        })
    return "\n---\n".join(lines), citations


async def rag_stream(
    session_id: str,
    question: str,
    chunks: List[Dict[str, Any]],
    history: List[Dict[str, str]] | None = None,
) -> AsyncGenerator[Tuple[str, Any], None]:
    """Async generator yielding tuples of (event_type, payload).

    Events:
      ("citations", [ ... ])   emitted once before token streaming
      ("token", str)           for each streamed text chunk
      ("done", None)           final event
    """
    api_key = os.environ["LLM_API_KEY"]
    base_url = os.environ.get("LLM_BASE_URL") or None
    model = os.environ.get("LLM_MODEL", "gpt-4o-mini")

    retrieved = hybrid_search(question, chunks, top_k=8)
    context_block, citations = build_context_block(retrieved)

    yield ("citations", citations)

    if not retrieved:
        # No documents indexed yet — respond deterministically.
        msg = "I couldn't find this information inside your uploaded documents."
        for word in msg.split(" "):
            yield ("token", word + " ")
        yield ("done", None)
        return

    # Compose the user message including transcript for continuity.
    transcript = ""
    for h in (history or [])[-6:]:
        role = h.get("role", "user").upper()
        content = h.get("content", "")
        transcript += f"\n[{role}]: {content}"

    user_prompt = (
        f"Conversation so far:{transcript}\n\n" if transcript else ""
    ) + (
        "Answer the user's next question using only the CONTEXT below.\n"
        "Cite sources inline as [filename:page].\n\n"
        f"CONTEXT:\n{context_block}\n\n"
        f"QUESTION: {question}\n\n"
        "Answer:"
    )

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield ("token", delta)
    except Exception as e:  # graceful fallback
        yield ("token", f"\n\n[Error contacting the model: {e}]")
    yield ("done", None)
