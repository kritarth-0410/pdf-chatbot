"""Main FastAPI application for the AI PDF Agent.

Endpoints (all prefixed with /api):

- Folders:        GET/POST /folders, DELETE /folders/{id}
- PDFs:           POST /pdfs/upload, GET /pdfs, GET /pdfs/{id},
                  PATCH /pdfs/{id}, DELETE /pdfs/{id}, GET /pdfs/{id}/file,
                  GET /pdfs/{id}/summary
- Conversations:  POST /conversations, GET /conversations,
                  PATCH /conversations/{id}, DELETE /conversations/{id},
                  GET /conversations/{id}/messages,
                  GET /conversations/{id}/export
- Chat:           POST /chat/stream (SSE)
- Search:         GET /search?q=
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import (
    APIRouter,
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware

from models import (
    ChatRequest,
    Conversation,
    ConversationCreate,
    ConversationPatch,
    Folder,
    FolderCreate,
    Message,
    Pdf,
    PdfPatch,
)
from pdf_processor import process_pdf
from embeddings import embed_texts
from rag import rag_stream, SYSTEM_PROMPT
from openai import AsyncOpenAI


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="AI PDF Agent")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pdf-agent")


# ---------- helpers ----------

def _clean(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


async def _touch_conversation(conv_id: str):
    from datetime import datetime, timezone
    await db.conversations.update_one(
        {"id": conv_id},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )


# ---------- folders ----------

@api.post("/folders", response_model=Folder)
async def create_folder(body: FolderCreate):
    folder = Folder(name=body.name)
    await db.folders.insert_one(folder.model_dump())
    return folder


@api.get("/folders", response_model=List[Folder])
async def list_folders():
    docs = await db.folders.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return docs


@api.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str):
    await db.folders.delete_one({"id": folder_id})
    # Move any pdfs from this folder to root
    await db.pdfs.update_many({"folder_id": folder_id}, {"$set": {"folder_id": None}})
    return {"ok": True}


# ---------- pdfs ----------

async def _ingest_pdf(pdf_id: str, path: Path):
    """Background job: extract, chunk, embed, index."""
    try:
        await db.pdfs.update_one({"id": pdf_id}, {"$set": {"status": "processing"}})
        num_pages, chunks = await asyncio.to_thread(process_pdf, str(path))
        # Embed in reasonable batches
        BATCH = 64
        texts = [c.text for c in chunks]
        all_embs: list[list[float]] = []
        for i in range(0, len(texts), BATCH):
            batch = texts[i : i + BATCH]
            embs = await asyncio.to_thread(embed_texts, batch)
            all_embs.extend(embs)

        docs = []
        import uuid
        for c, emb in zip(chunks, all_embs):
            docs.append({
                "id": str(uuid.uuid4()),
                "pdf_id": pdf_id,
                "page": c.page,
                "section": c.section,
                "text": c.text,
                "token_count": c.token_count,
                "embedding": emb,
            })
        if docs:
            await db.chunks.insert_many(docs)
        await db.pdfs.update_one(
            {"id": pdf_id},
            {"$set": {"status": "ready", "num_pages": num_pages, "error": None}},
        )
        logger.info(f"Ingested {pdf_id}: {num_pages} pages, {len(docs)} chunks")
    except Exception as e:
        logger.exception("ingest failed")
        await db.pdfs.update_one(
            {"id": pdf_id},
            {"$set": {"status": "failed", "error": str(e)}},
        )


@api.post("/pdfs/upload", response_model=List[Pdf])
async def upload_pdfs(
    background: BackgroundTasks,
    files: List[UploadFile] = File(...),
    folder_id: Optional[str] = Form(None),
):
    if not files:
        raise HTTPException(400, "No files provided")
    created = []
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".pdf"):
            continue
        data = await f.read()
        if len(data) > 40 * 1024 * 1024:  # 40MB cap
            raise HTTPException(413, f"{f.filename} exceeds 40MB")
        pdf = Pdf(
            name=f.filename,
            original_name=f.filename,
            folder_id=folder_id or None,
            size_bytes=len(data),
        )
        # store file to disk
        target = UPLOAD_DIR / f"{pdf.id}.pdf"
        target.write_bytes(data)
        await db.pdfs.insert_one(pdf.model_dump())
        background.add_task(_ingest_pdf, pdf.id, target)
        created.append(pdf)
    if not created:
        raise HTTPException(400, "No valid PDF files uploaded")
    return created


@api.get("/pdfs", response_model=List[Pdf])
async def list_pdfs(folder_id: Optional[str] = None, q: Optional[str] = None):
    query: dict = {}
    if folder_id == "root":
        query["folder_id"] = None
    elif folder_id:
        query["folder_id"] = folder_id
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    docs = await db.pdfs.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api.get("/pdfs/{pdf_id}", response_model=Pdf)
async def get_pdf(pdf_id: str):
    doc = await db.pdfs.find_one({"id": pdf_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PDF not found")
    return doc


@api.patch("/pdfs/{pdf_id}", response_model=Pdf)
async def patch_pdf(pdf_id: str, body: PdfPatch):
    updates = {k: v for k, v in body.model_dump(exclude_none=False).items() if v is not None}
    if body.folder_id == "":
        updates["folder_id"] = None
    if not updates:
        raise HTTPException(400, "No changes")
    res = await db.pdfs.update_one({"id": pdf_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "PDF not found")
    doc = await db.pdfs.find_one({"id": pdf_id}, {"_id": 0})
    return doc


@api.delete("/pdfs/{pdf_id}")
async def delete_pdf(pdf_id: str):
    await db.chunks.delete_many({"pdf_id": pdf_id})
    await db.pdfs.delete_one({"id": pdf_id})
    p = UPLOAD_DIR / f"{pdf_id}.pdf"
    if p.exists():
        p.unlink()
    return {"ok": True}


@api.get("/pdfs/{pdf_id}/file")
async def get_pdf_file(pdf_id: str):
    p = UPLOAD_DIR / f"{pdf_id}.pdf"
    if not p.exists():
        raise HTTPException(404, "File missing")
    meta = await db.pdfs.find_one({"id": pdf_id}, {"_id": 0, "name": 1})
    return FileResponse(
        str(p),
        media_type="application/pdf",
        filename=meta["name"] if meta else "document.pdf",
        headers={"Cache-Control": "private, max-age=300"},
    )


@api.get("/pdfs/{pdf_id}/summary")
async def summarize_pdf(pdf_id: str):
    doc = await db.pdfs.find_one({"id": pdf_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PDF not found")
    if doc.get("summary"):
        return {"summary": doc["summary"]}
    # gather first ~8k chars from chunks
    chunks = await db.chunks.find({"pdf_id": pdf_id}, {"_id": 0, "text": 1, "page": 1}).sort("page", 1).to_list(60)
    if not chunks:
        raise HTTPException(400, "PDF not yet processed")
    text = "\n\n".join(c["text"] for c in chunks[:20])[:12000]
    client = AsyncOpenAI(
        api_key=os.environ["LLM_API_KEY"],
        base_url=os.environ.get("LLM_BASE_URL") or None,
    )
    model = os.environ.get("LLM_MODEL", "gpt-4o-mini")
    prompt = (
        "Summarize this document in 5-8 bullet points and a one-line title. "
        "Return markdown with a '### Title' line followed by bullets. "
        "Use only information present below.\n\n" + text
    )
    parts = []
    stream = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a document summarizer. Produce faithful, structured summaries."},
            {"role": "user", "content": prompt},
        ],
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            parts.append(delta)
    summary = "".join(parts).strip()
    await db.pdfs.update_one({"id": pdf_id}, {"$set": {"summary": summary}})
    return {"summary": summary}


# ---------- conversations ----------

@api.post("/conversations", response_model=Conversation)
async def create_conversation(body: ConversationCreate):
    conv = Conversation(title=body.title or "New chat", pdf_ids=body.pdf_ids)
    await db.conversations.insert_one(conv.model_dump())
    return conv


@api.get("/conversations", response_model=List[Conversation])
async def list_conversations():
    docs = await db.conversations.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return docs


@api.patch("/conversations/{conv_id}", response_model=Conversation)
async def patch_conversation(conv_id: str, body: ConversationPatch):
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(400, "No changes")
    res = await db.conversations.update_one({"id": conv_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Conversation not found")
    doc = await db.conversations.find_one({"id": conv_id}, {"_id": 0})
    return doc


@api.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    await db.messages.delete_many({"conversation_id": conv_id})
    await db.conversations.delete_one({"id": conv_id})
    return {"ok": True}


@api.get("/conversations/{conv_id}/messages", response_model=List[Message])
async def get_messages(conv_id: str):
    docs = await db.messages.find({"conversation_id": conv_id}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    return docs


@api.get("/conversations/{conv_id}/export")
async def export_conversation(conv_id: str):
    conv = await db.conversations.find_one({"id": conv_id}, {"_id": 0})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    msgs = await db.messages.find({"conversation_id": conv_id}, {"_id": 0}).sort("created_at", 1).to_list(5000)
    md = [f"# {conv['title']}", "", f"_Exported from DocuMind_", ""]
    for m in msgs:
        who = "User" if m["role"] == "user" else "DocuMind"
        md.append(f"### {who}")
        md.append(m["content"])
        if m.get("citations"):
            md.append("")
            md.append("**Sources:**")
            for c in m["citations"]:
                md.append(f"- {c['pdf_name']} — p.{c['page']}")
        md.append("")
    body = "\n".join(md)
    return StreamingResponse(
        iter([body]),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{conv["title"]}.md"'},
    )


# ---------- chat (SSE) ----------

@api.post("/chat/stream")
async def chat_stream(body: ChatRequest):
    conv = await db.conversations.find_one({"id": body.conversation_id}, {"_id": 0})
    if not conv:
        raise HTTPException(404, "Conversation not found")

    pdf_ids = body.pdf_ids or conv.get("pdf_ids") or []
    if not pdf_ids:
        # default to all pdfs
        pdfs = await db.pdfs.find({"status": "ready"}, {"_id": 0, "id": 1}).to_list(500)
        pdf_ids = [p["id"] for p in pdfs]

    # Save user message
    user_msg = Message(
        conversation_id=body.conversation_id,
        role="user",
        content=body.message,
    )
    await db.messages.insert_one(user_msg.model_dump())

    # Auto-title conversation on first user message
    existing_count = await db.messages.count_documents({"conversation_id": body.conversation_id})
    if existing_count == 1 and conv.get("title") in ("New chat", "", None):
        title = body.message.strip()[:60]
        await db.conversations.update_one(
            {"id": body.conversation_id},
            {"$set": {"title": title, "pdf_ids": pdf_ids}},
        )
    else:
        await db.conversations.update_one(
            {"id": body.conversation_id},
            {"$set": {"pdf_ids": pdf_ids}},
        )

    # Load chunks with pdf name
    pdf_docs = await db.pdfs.find({"id": {"$in": pdf_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    pdf_name_map = {p["id"]: p["name"] for p in pdf_docs}
    chunk_docs = await db.chunks.find({"pdf_id": {"$in": pdf_ids}}, {"_id": 0}).to_list(20000)
    for c in chunk_docs:
        c["pdf_name"] = pdf_name_map.get(c["pdf_id"], "document")

    # History for context
    hist_docs = await db.messages.find(
        {"conversation_id": body.conversation_id}, {"_id": 0, "role": 1, "content": 1}
    ).sort("created_at", 1).to_list(20)

    async def event_gen():
        collected = []
        citations = []
        try:
            async for kind, payload in rag_stream(
                session_id=body.conversation_id,
                question=body.message,
                chunks=chunk_docs,
                history=hist_docs[:-1],  # exclude current
            ):
                if kind == "citations":
                    citations = payload
                    yield f"event: citations\ndata: {json.dumps(payload)}\n\n"
                elif kind == "token":
                    collected.append(payload)
                    yield f"event: token\ndata: {json.dumps(payload)}\n\n"
                elif kind == "done":
                    break
            answer = "".join(collected).strip()
            assistant_msg = Message(
                conversation_id=body.conversation_id,
                role="assistant",
                content=answer,
                citations=citations,
            )
            await db.messages.insert_one(assistant_msg.model_dump())
            await _touch_conversation(body.conversation_id)
            yield f"event: done\ndata: {json.dumps({'message_id': assistant_msg.id})}\n\n"
        except Exception as e:
            logger.exception("stream error")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------- search ----------

@api.get("/search")
async def search(q: str = Query(..., min_length=1)):
    """Global lightweight search across pdf names + a snippet of best chunk."""
    pdfs = await db.pdfs.find(
        {"name": {"$regex": q, "$options": "i"}},
        {"_id": 0},
    ).limit(20).to_list(20)
    return {"pdfs": pdfs}


# ---------- health ----------

@api.get("/")
async def root():
    return {"service": "AI PDF Agent", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def _shutdown():
    client.close()
