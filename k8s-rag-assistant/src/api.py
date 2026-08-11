import os
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vectorstore import build_index
from rag import ask as rag_ask
from ingest import build_chunks
from order_agent import ask_buyer

STATIC_DIR = Path(__file__).parent / "static"
LOG_FILE = Path(__file__).parent / "query_log.json"

app = FastAPI(title="K8s Incident Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_state = {"store": None, "embedder": None, "backend": None, "chunk_count": 0, "built_at": None}


def _do_build(backend: str):
    store, embedder = build_index(backend=backend)
    _state["store"] = store
    _state["embedder"] = embedder
    _state["backend"] = backend
    _state["chunk_count"] = len(build_chunks())
    _state["built_at"] = datetime.utcnow().isoformat()


def _append_log(question, answer, sources, ok, error=None):
    entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "question": question, "answer": answer, "sources": sources,
        "ok": ok, "error": error,
    }
    logs = []
    if LOG_FILE.exists():
        try:
            logs = json.loads(LOG_FILE.read_text())
        except Exception:
            logs = []
    logs.append(entry)
    logs = logs[-200:]
    LOG_FILE.write_text(json.dumps(logs, indent=2))


@app.on_event("startup")
def startup():
    backend = os.environ.get("EMBED_BACKEND", "openai")
    try:
        _do_build(backend)
    except Exception as e:
        print(f"[startup] index build failed with backend='{backend}': {e}")
        print("[startup] falling back to 'tfidf' (offline, no API key needed)")
        _do_build("tfidf")


class QueryRequest(BaseModel):
    question: str
    top_k: int = 3


class QueryResponse(BaseModel):
    question: str
    answer: str
    sources: list


@app.post("/api/query", response_model=QueryResponse)
def query(req: QueryRequest):
    if not req.question.strip():
        raise HTTPException(400, "Question cannot be empty.")
    if _state["store"] is None:
        raise HTTPException(503, "Index not ready yet.")
    try:
        result = rag_ask(req.question, _state["store"], _state["embedder"], top_k=req.top_k)
        _append_log(req.question, result["answer"], result["sources"], ok=True)
        return QueryResponse(**result)
    except Exception as e:
        _append_log(req.question, None, [], ok=False, error=str(e))
        raise HTTPException(500, f"Generation failed: {e}")


@app.get("/api/health")
def health():
    return {
        "status": "ok" if _state["store"] else "not_ready",
        "backend": _state["backend"],
        "chunk_count": _state["chunk_count"],
        "built_at": _state["built_at"],
    }


class BuyerQueryRequest(BaseModel):
    question: str
    username: str


class BuyerQueryResponse(BaseModel):
    question: str
    answer: str
    tool_trace: list


@app.post("/api/buyer/query", response_model=BuyerQueryResponse)
def buyer_query(req: BuyerQueryRequest):
    if not req.question.strip():
        raise HTTPException(400, "Question cannot be empty.")
    try:
        result = ask_buyer(req.question, username=req.username)
        return BuyerQueryResponse(**result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Buyer assistant failed: {e}")


@app.get("/buyer")
def serve_buyer_ui():
    return FileResponse(STATIC_DIR / "buyer" / "index.html")


@app.get("/admin/api/status")
def admin_status():
    return {"backend": _state["backend"], "chunk_count": _state["chunk_count"], "built_at": _state["built_at"]}


@app.get("/admin/api/docs")
def admin_docs():
    chunks = build_chunks()
    by_source = {}
    for c in chunks:
        by_source.setdefault(c.source, 0)
        by_source[c.source] += 1
    return {"documents": [{"source": k, "chunk_count": v} for k, v in by_source.items()]}


class ReindexRequest(BaseModel):
    backend: str = "openai"


@app.post("/admin/api/reindex")
def admin_reindex(req: ReindexRequest):
    try:
        _do_build(req.backend)
        return {"ok": True, "backend": _state["backend"], "chunk_count": _state["chunk_count"]}
    except Exception as e:
        raise HTTPException(500, f"Reindex failed: {e}")


@app.get("/admin/api/logs")
def admin_logs(limit: int = 50):
    if not LOG_FILE.exists():
        return {"logs": []}
    logs = json.loads(LOG_FILE.read_text())
    return {"logs": list(reversed(logs))[:limit]}


@app.get("/")
def serve_user_ui():
    return FileResponse(STATIC_DIR / "user" / "index.html")


@app.get("/admin")
def serve_admin_ui():
    return FileResponse(STATIC_DIR / "admin" / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
