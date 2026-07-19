"""PDF extraction and intelligent chunking.

Uses PyMuPDF to extract text with page-level metadata. Chunking targets a
target token size while respecting page boundaries and paragraph breaks.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional
import re

import fitz  # PyMuPDF


CHUNK_TARGET_TOKENS = 850
CHUNK_OVERLAP_TOKENS = 150


def _approx_tokens(text: str) -> int:
    # Fast approximation: 1 token ~= 4 chars for English prose.
    return max(1, len(text) // 4)


@dataclass
class RawChunk:
    text: str
    page: int
    section: Optional[str]
    token_count: int


def extract_pages(path: str) -> List[dict]:
    """Return list of {page, text} dicts, 1-indexed pages."""
    doc = fitz.open(path)
    pages = []
    for i, page in enumerate(doc, start=1):
        text = page.get_text("text") or ""
        # Basic cleanup
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        pages.append({"page": i, "text": text})
    doc.close()
    return pages


def _split_paragraphs(text: str) -> List[str]:
    parts = re.split(r"\n\s*\n", text)
    return [p.strip() for p in parts if p.strip()]


def _detect_heading(para: str) -> Optional[str]:
    """Guess if a paragraph is a heading (short, title-cased or all caps)."""
    if not para or "\n" in para:
        return None
    if len(para) > 90:
        return None
    words = para.split()
    if len(words) < 2 or len(words) > 12:
        return None
    caps = sum(1 for w in words if w[:1].isupper())
    if caps / len(words) >= 0.6:
        return para.strip()
    return None


def chunk_pages(pages: List[dict]) -> List[RawChunk]:
    """Group paragraphs into overlapping chunks, keeping page + heading info."""
    chunks: List[RawChunk] = []
    current_text = ""
    current_page = pages[0]["page"] if pages else 1
    current_section: Optional[str] = None
    current_tokens = 0

    def flush():
        nonlocal current_text, current_tokens
        if current_text.strip():
            chunks.append(RawChunk(
                text=current_text.strip(),
                page=current_page,
                section=current_section,
                token_count=current_tokens,
            ))
        current_text = ""
        current_tokens = 0

    for page in pages:
        page_num = page["page"]
        paragraphs = _split_paragraphs(page["text"])
        for para in paragraphs:
            heading = _detect_heading(para)
            if heading:
                # flush current chunk on new section boundary
                flush()
                current_section = heading
                current_page = page_num
                # include heading in chunk as context
                current_text = heading + "\n\n"
                current_tokens = _approx_tokens(heading)
                continue

            tok = _approx_tokens(para)
            if current_tokens + tok > CHUNK_TARGET_TOKENS and current_text:
                flush()
                current_page = page_num
                # apply overlap by carrying the tail of previous chunk
                if chunks:
                    prev = chunks[-1].text
                    tail = prev[-CHUNK_OVERLAP_TOKENS * 4:]
                    current_text = tail + "\n\n"
                    current_tokens = _approx_tokens(tail)
            if not current_text:
                current_page = page_num
            current_text += para + "\n\n"
            current_tokens += tok
    flush()
    return chunks


def process_pdf(path: str) -> tuple[int, List[RawChunk]]:
    pages = extract_pages(path)
    chunks = chunk_pages(pages)
    return len(pages), chunks
