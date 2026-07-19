# DocuMind

A full-stack RAG (retrieval-augmented generation) app for chatting with your PDFs. Upload documents, organize them into folders, and ask questions grounded strictly in what's inside your files — every answer is cited with the source PDF and page number.

## How it works

1. **Upload** a PDF. The backend extracts and chunks the text (`pdf_processor.py`), generates embeddings for each chunk (`embeddings.py`), and stores them.
2. **Ask a question.** The backend runs a hybrid search over your documents (`retrieval.py`) to pull the most relevant chunks.
3. **Get a grounded answer.** Those chunks are passed to the LLM (`rag.py`), which is instructed to answer only from the provided context and cite sources inline as `[filename.pdf:page]`. If the answer isn't in your documents, it says so instead of guessing.

Responses stream back to the frontend over Server-Sent Events, so answers appear token by token instead of all at once.

## Tech stack

**Backend**
- FastAPI (Python) serving a REST + streaming API under `/api`
- MongoDB (via Motor, the async driver) for storing folders, PDFs, conversations, and messages
- `emergentintegrations` for LLM calls, `sentence-transformers` for embeddings

**Frontend**
- React 19 with `react-router-dom`
- Tailwind CSS + shadcn/ui (Radix primitives) for the UI
- `react-pdf` for in-browser PDF viewing
- TanStack Query / SWR for data fetching

## Project structure

```
.
├── backend/
│   ├── server.py          # FastAPI app + all API routes
│   ├── models.py          # Pydantic models (Folder, Pdf, Conversation, Message, ...)
│   ├── pdf_processor.py   # PDF text extraction and chunking
│   ├── embeddings.py      # Embedding generation
│   ├── retrieval.py       # Hybrid search over stored chunks
│   ├── rag.py             # Prompt construction + streaming LLM orchestration
│   ├── requirements.txt
│   └── .env.example       # Copy to .env and fill in your own values
├── frontend/
│   ├── src/
│   │   ├── pages/          # Route-level pages (e.g. Workspace.js)
│   │   ├── components/     # UI components (components/ui = shadcn primitives)
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── constants/
│   └── package.json
├── tests/                  # Backend test suite
└── design_guidelines.json
```

## API overview

All routes are prefixed with `/api`.

| Area          | Routes |
|---------------|--------|
| Folders       | `GET/POST /folders`, `DELETE /folders/{id}` |
| PDFs          | `POST /pdfs/upload`, `GET /pdfs`, `GET /pdfs/{id}`, `PATCH /pdfs/{id}`, `DELETE /pdfs/{id}`, `GET /pdfs/{id}/file`, `GET /pdfs/{id}/summary` |
| Conversations | `POST /conversations`, `GET /conversations`, `PATCH /conversations/{id}`, `DELETE /conversations/{id}`, `GET /conversations/{id}/messages`, `GET /conversations/{id}/export` |
| Chat          | `POST /chat/stream` (Server-Sent Events) |
| Search        | `GET /search?q=` |

## Getting started

### Prerequisites
- Python 3.11
- Node.js + Yarn
- A running MongoDB instance

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # then fill in your own values
uvicorn server:app --reload --port 8000
```

Environment variables (see `.env.example`):

| Variable | Purpose |
|---|---|
| `MONGO_URL` | MongoDB connection string |
| `DB_NAME` | Database name |
| `CORS_ORIGINS` | Allowed origins for the frontend |
| `LLM_API_KEY` | API key for your LLM provider (OpenAI or any OpenAI-compatible API) |
| `LLM_MODEL` | Model name for chat/generation, e.g. `gpt-4o-mini` |
| `LLM_BASE_URL` | Optional. Set this to point at a different OpenAI-compatible provider (Groq, Together, a local Ollama server, etc). Leave blank to use OpenAI directly. |
| `UPLOAD_DIR` | Where uploaded PDFs are stored on disk |
| `EMBED_MODEL` | Model name for embeddings |

This app uses the standard `openai` Python SDK for LLM calls, not any platform-specific wrapper, so it runs anywhere — any machine, any host, any OpenAI-compatible provider.

### Frontend

```bash
cd frontend
yarn install
yarn start
```

### Tests

```bash
cd backend
pytest
```

## Notes

- `backend/uploads/` holds uploaded PDF files on disk — not meant to be committed with real user data.
- Never commit a real `.env` file; use `.env.example` as the template and keep actual keys local.
