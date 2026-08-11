import os
import chromadb
from ingest import Chunk, chunk_text
from embeddings import get_embedder, LocalSentenceTransformerEmbedder


def _load_policy_docs():
    this_dir = os.path.dirname(os.path.abspath(__file__))
    candidate_container = os.path.join(this_dir, "docs_buyer")
    candidate_local = os.path.join(os.path.dirname(this_dir), "docs_buyer")
    docs_dir = candidate_container if os.path.isdir(candidate_container) else candidate_local
    chunks = []
    for filename in sorted(os.listdir(docs_dir)):
        if not filename.endswith(".md"):
            continue
        with open(os.path.join(docs_dir, filename), "r", encoding="utf-8") as f:
            content = f.read()
        for i, t in enumerate(chunk_text(content, chunk_size=500, overlap=50)):
            chunks.append(Chunk(text=t, source=filename, chunk_index=i))
    return chunks


class PolicyStore:
    _instance = None

    def __init__(self, backend="openai"):
        self.client = chromadb.PersistentClient(path="./chroma_policy_db")
        try:
            self.client.delete_collection("store_policies")
        except Exception:
            pass
        self.collection = self.client.create_collection("store_policies")
        self.embedder = get_embedder(backend)

        chunks = _load_policy_docs()
        texts = [c.text for c in chunks]
        if isinstance(self.embedder, LocalSentenceTransformerEmbedder):
            self.embedder.fit(texts)
        vectors = self.embedder.embed(texts)
        self.collection.add(
            ids=[f"{c.source}::{c.chunk_index}" for c in chunks],
            embeddings=vectors,
            documents=texts,
            metadatas=[{"source": c.source, "chunk_index": c.chunk_index} for c in chunks],
        )

    @classmethod
    def get(cls, backend="openai"):
        if cls._instance is None:
            cls._instance = cls(backend=backend)
        return cls._instance

    def search(self, query: str, top_k: int = 2) -> dict:
        query_vector = self.embedder.embed_query(query)
        results = self.collection.query(query_embeddings=[query_vector], n_results=top_k)
        chunks = []
        for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
            chunks.append({"text": doc, "source": meta["source"]})
        return {"found": len(chunks) > 0, "results": chunks}


def search_store_policies(query: str) -> dict:
    store = PolicyStore.get(backend=os.environ.get("EMBED_BACKEND", "openai"))
    return store.search(query, top_k=2)
