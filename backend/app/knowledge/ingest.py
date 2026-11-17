"""Document parsing, chunking and indexing (tenant scoped)."""

import io
import re

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.knowledge.text import tokenize
from app.models import KnowledgeChunk, KnowledgeDocument
from app.models.base import utcnow

CHUNK_CHARS = 900
CHUNK_OVERLAP = 150


def extract_text(filename: str, data: bytes) -> tuple[str, str]:
    """Return (source_type, text). Raises ValueError for unsupported files."""
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "pdf", "\n\n".join((p.extract_text() or "") for p in reader.pages)
    if name.endswith(".docx"):
        import docx

        d = docx.Document(io.BytesIO(data))
        return "docx", "\n".join(p.text for p in d.paragraphs)
    if name.endswith((".txt", ".md", ".csv")):
        return "text", data.decode("utf-8", errors="replace")
    raise ValueError("Unsupported file type. Upload PDF, DOCX, TXT, MD or CSV.")


def chunk_text(text: str, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text).strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paragraphs:
        if len(buf) + len(p) + 1 <= size:
            buf = f"{buf}\n{p}" if buf else p
            continue
        if buf:
            chunks.append(buf)
        while len(p) > size:
            chunks.append(p[:size])
            p = p[size - overlap:]
        buf = p
    if buf:
        chunks.append(buf)
    return chunks


async def index_document(db: AsyncSession, doc: KnowledgeDocument) -> None:
    await db.execute(delete(KnowledgeChunk).where(
        KnowledgeChunk.document_id == doc.id, KnowledgeChunk.tenant_id == doc.tenant_id))
    pieces = chunk_text(doc.raw_text)
    for i, piece in enumerate(pieces):
        db.add(KnowledgeChunk(
            tenant_id=doc.tenant_id, document_id=doc.id, agent_id=doc.agent_id,
            position=i, content=piece, tokens=tokenize(f"{doc.title} {piece}"),
        ))
    doc.chunk_count = len(pieces)
    doc.status = "indexed" if pieces else "failed"
    doc.error = None if pieces else "No extractable text found"
    doc.updated_at = utcnow()  # always bump: the retrieval cache is invalidated by this timestamp
