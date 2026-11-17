from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin


class KnowledgeDocument(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_documents"
    # NULL agent_id = shared by all agents of the tenant.
    agent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agents.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    source_type: Mapped[str] = mapped_column(String(20))  # pdf | docx | text | faq | policy
    filename: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | indexed | failed
    error: Mapped[str | None] = mapped_column(Text)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    raw_text: Mapped[str] = mapped_column(Text, default="")


class KnowledgeChunk(IdMixin, TenantMixin, Base):
    __tablename__ = "knowledge_chunks"
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_documents.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str | None] = mapped_column(String(36), index=True)
    position: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    tokens: Mapped[list] = mapped_column(JSON, default=list)  # normalised terms for BM25
    # Reserved for pgvector embeddings (Phase 3). Stored as JSON so SQLite dev works.
    embedding: Mapped[list | None] = mapped_column(JSON)
