import os
import glob
from dataclasses import dataclass
from typing import List


@dataclass
class Chunk:
    text: str
    source: str
    chunk_index: int


def load_documents(docs_dir: str = None) -> List[tuple[str, str]]:
    if docs_dir is None:
        # Works both locally (src/ingest.py -> up one level -> project root/docs)
        # and in the container (ingest.py directly in /app -> /app/docs)
        this_dir = os.path.dirname(os.path.abspath(__file__))
        candidate_container = os.path.join(this_dir, "docs")
        candidate_local = os.path.join(os.path.dirname(this_dir), "docs")
        docs_dir = candidate_container if os.path.isdir(candidate_container) else candidate_local

    documents = []
    for filepath in sorted(glob.glob(os.path.join(docs_dir, "*.md"))):
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        documents.append((os.path.basename(filepath), content))

    if not documents:
        raise FileNotFoundError(f"No .md files found in '{docs_dir}'.")
    return documents


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
    sections = text.split("\n## ")
    sections = [sections[0]] + ["## " + s for s in sections[1:]]

    chunks = []
    for section in sections:
        section = section.strip()
        if not section:
            continue
        if len(section) <= chunk_size:
            chunks.append(section)
        else:
            start = 0
            while start < len(section):
                end = start + chunk_size
                chunks.append(section[start:end])
                start = end - overlap
    return chunks


def build_chunks(docs_dir: str = None, chunk_size: int = 800, overlap: int = 100) -> List[Chunk]:
    all_chunks: List[Chunk] = []
    for filename, content in load_documents(docs_dir):
        text_chunks = chunk_text(content, chunk_size=chunk_size, overlap=overlap)
        for i, t in enumerate(text_chunks):
            all_chunks.append(Chunk(text=t, source=filename, chunk_index=i))
    return all_chunks
