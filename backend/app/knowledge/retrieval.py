"""Tenant-scoped BM25 retrieval over knowledge chunks.

The BM25 index for each (tenant, agent) scope is built once and cached in-process. Every search first
runs one cheap aggregate query (document count, chunk count, latest document update); the cached index
is rebuilt only when that signature changes, so a voice turn no longer loads every chunk.

Phase 3 swaps this for pgvector hybrid search behind the same `search` signature.
"""

import math
from collections import Counter, OrderedDict
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.knowledge.text import tokenize
from app.models import KnowledgeChunk, KnowledgeDocument


@dataclass
class Hit:
    content: str
    title: str
    score: float
    document_id: str


@dataclass
class _Doc:
    content: str
    title: str
    document_id: str
    tf: Counter
    length: int


@dataclass
class _Index:
    signature: tuple
    docs: list[_Doc]
    df: Counter
    avg_len: float


_CACHE: OrderedDict[tuple[str, str | None], _Index] = OrderedDict()
_CACHE_MAX = 256  # scopes kept in memory (LRU)


def clear_cache() -> None:
    _CACHE.clear()


def _scope(stmt, tenant_id: str, agent_id: str | None):
    stmt = stmt.where(KnowledgeChunk.tenant_id == tenant_id, KnowledgeDocument.tenant_id == tenant_id)
    if agent_id:
        stmt = stmt.where(or_(KnowledgeChunk.agent_id.is_(None), KnowledgeChunk.agent_id == agent_id))
    return stmt


async def _signature(db: AsyncSession, tenant_id: str, agent_id: str | None) -> tuple:
    stmt = _scope(select(func.count(KnowledgeChunk.id), func.count(func.distinct(KnowledgeDocument.id)),
                         func.max(KnowledgeDocument.updated_at))
                  .select_from(KnowledgeChunk)
                  .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id), tenant_id, agent_id)
    n_chunks, n_docs, latest = (await db.execute(stmt)).one()
    return (n_chunks, n_docs, str(latest))


async def _index(db: AsyncSession, tenant_id: str, agent_id: str | None) -> _Index:
    key = (tenant_id, agent_id)
    sig = await _signature(db, tenant_id, agent_id)
    cached = _CACHE.get(key)
    if cached and cached.signature == sig:
        _CACHE.move_to_end(key)
        return cached
    stmt = _scope(select(KnowledgeChunk.content, KnowledgeChunk.tokens, KnowledgeChunk.document_id,
                         KnowledgeDocument.title)
                  .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id), tenant_id, agent_id)
    docs, df = [], Counter()
    for content, tokens, doc_id, title in (await db.execute(stmt)).all():
        tokens = tokens or []
        docs.append(_Doc(content, title, doc_id, Counter(tokens), len(tokens) or 1))
        df.update(set(tokens))
    avg_len = (sum(d.length for d in docs) / len(docs)) if docs else 1.0
    idx = _Index(sig, docs, df, avg_len)
    _CACHE[key] = idx
    _CACHE.move_to_end(key)
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return idx


async def search(db: AsyncSession, *, tenant_id: str, agent_id: str | None, query: str, k: int = 3) -> list[Hit]:
    q_terms = tokenize(query)
    if not q_terms:
        return []
    idx = await _index(db, tenant_id, agent_id)
    n = len(idx.docs)
    if not n:
        return []
    k1, b = 1.5, 0.75
    hits = []
    for d in idx.docs:
        score = 0.0
        for t in q_terms:
            tf = d.tf.get(t)
            if not tf:
                continue
            df = idx.df[t]
            idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
            score += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * d.length / idx.avg_len))
        if score > 0:
            hits.append(Hit(content=d.content, title=d.title, score=score, document_id=d.document_id))
    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[:k]
