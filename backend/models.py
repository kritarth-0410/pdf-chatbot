"""Pydantic models for the PDF Agent API.

Documents are stored in MongoDB. UUIDs are used as primary keys so that IDs
are easy to expose over the API and safe to embed in URLs and JSON.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional, Literal

from pydantic import BaseModel, Field, ConfigDict


def _uuid() -> str:
    import uuid
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Folder(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    name: str
    created_at: str = Field(default_factory=_now)


class FolderCreate(BaseModel):
    name: str


class Pdf(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    name: str
    original_name: str
    folder_id: Optional[str] = None
    size_bytes: int = 0
    num_pages: int = 0
    status: Literal["uploaded", "processing", "ready", "failed"] = "uploaded"
    error: Optional[str] = None
    summary: Optional[str] = None
    created_at: str = Field(default_factory=_now)


class PdfPatch(BaseModel):
    name: Optional[str] = None
    folder_id: Optional[str] = None  # empty string "" means unset


class Chunk(BaseModel):
    """A single chunk of a PDF stored in Mongo with its embedding."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    pdf_id: str
    page: int
    section: Optional[str] = None
    text: str
    token_count: int = 0
    embedding: List[float] = Field(default_factory=list)


class Conversation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    title: str = "New chat"
    pdf_ids: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=_now)
    updated_at: str = Field(default_factory=_now)


class ConversationCreate(BaseModel):
    title: Optional[str] = None
    pdf_ids: List[str] = Field(default_factory=list)


class ConversationPatch(BaseModel):
    title: Optional[str] = None
    pdf_ids: Optional[List[str]] = None


class Citation(BaseModel):
    pdf_id: str
    pdf_name: str
    page: int
    snippet: str
    score: float = 0.0


class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    conversation_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    citations: List[Citation] = Field(default_factory=list)
    created_at: str = Field(default_factory=_now)


class ChatRequest(BaseModel):
    conversation_id: str
    message: str
    pdf_ids: Optional[List[str]] = None
