from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DB, Principal, audit, tenant_admin_scope, tenant_scope
from app.knowledge.ingest import extract_text, index_document
from app.knowledge.retrieval import search
from app.models import Agent, KnowledgeChunk, KnowledgeDocument
from app.schemas.api import KnowledgeDocOut, KnowledgeTextIn

router = APIRouter(prefix="/knowledge", tags=["knowledge"])
MAX_UPLOAD = 15 * 1024 * 1024


async def _check_agent(db: AsyncSession, p: Principal, agent_id: str | None) -> None:
    if agent_id and not (await db.execute(select(Agent.id).where(Agent.tenant_id == p.tenant_id, Agent.id == agent_id))).first():
        raise HTTPException(422, "Unknown agent")


@router.get("/documents", response_model=list[KnowledgeDocOut])
async def list_docs(p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    return (await db.execute(select(KnowledgeDocument).where(KnowledgeDocument.tenant_id == p.tenant_id)
                             .order_by(KnowledgeDocument.created_at.desc()))).scalars().all()


@router.post("/documents/upload", response_model=KnowledgeDocOut, status_code=201)
async def upload(request: Request, file: UploadFile = File(...), title: str | None = Form(None),
                 agent_id: str | None = Form(None), p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    await _check_agent(db, p, agent_id)
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 15 MB)")
    try:
        source_type, text = extract_text(file.filename or "upload.txt", data)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except Exception as e:
        raise HTTPException(422, f"Could not read file: {type(e).__name__}") from None
    doc = KnowledgeDocument(tenant_id=p.tenant_id, agent_id=agent_id, title=title or file.filename or "Document",
                            source_type=source_type, filename=file.filename, raw_text=text)
    db.add(doc)
    await db.flush()
    await index_document(db, doc)
    await audit(db, request, p, "upload", "knowledge_document", doc.id, filename=file.filename)
    await db.commit()
    return doc


@router.post("/documents/text", response_model=KnowledgeDocOut, status_code=201)
async def add_text(body: KnowledgeTextIn, request: Request, p: Principal = Depends(tenant_admin_scope),
                   db: AsyncSession = DB):
    await _check_agent(db, p, body.agent_id)
    doc = KnowledgeDocument(tenant_id=p.tenant_id, agent_id=body.agent_id, title=body.title,
                            source_type=body.source_type, raw_text=body.text)
    db.add(doc)
    await db.flush()
    await index_document(db, doc)
    await audit(db, request, p, "create", "knowledge_document", doc.id)
    await db.commit()
    return doc


async def _get(db: AsyncSession, p: Principal, doc_id: str) -> KnowledgeDocument:
    doc = (await db.execute(select(KnowledgeDocument).where(KnowledgeDocument.tenant_id == p.tenant_id,
                                                            KnowledgeDocument.id == doc_id))).scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc


@router.post("/documents/{doc_id}/reindex", response_model=KnowledgeDocOut)
async def reindex(doc_id: str, p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    doc = await _get(db, p, doc_id)
    await index_document(db, doc)
    await db.commit()
    return doc


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_doc(doc_id: str, request: Request, p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    doc = await _get(db, p, doc_id)
    await db.execute(delete(KnowledgeChunk).where(KnowledgeChunk.tenant_id == p.tenant_id,
                                                  KnowledgeChunk.document_id == doc.id))
    await db.delete(doc)
    await audit(db, request, p, "delete", "knowledge_document", doc_id)
    await db.commit()


@router.get("/search")
async def test_search(q: str, agent_id: str | None = None, p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    hits = await search(db, tenant_id=p.tenant_id, agent_id=agent_id, query=q, k=5)
    return [{"title": h.title, "score": round(h.score, 3), "content": h.content} for h in hits]
