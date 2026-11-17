import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DB, Principal, audit, tenant_admin_scope
from app.integrations.connections import adapter_for
from app.models import DatabaseConnection
from app.schemas.api import DBConnectionIn, DBConnectionOut
from app.security.crypto import decrypt_secret, encrypt_secret

router = APIRouter(prefix="/integrations/connections", tags=["integrations"])


@router.get("", response_model=list[DBConnectionOut])
async def list_connections(p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    return (await db.execute(select(DatabaseConnection).where(DatabaseConnection.tenant_id == p.tenant_id))).scalars().all()


@router.post("", response_model=DBConnectionOut, status_code=201)
async def create_connection(body: DBConnectionIn, request: Request, p: Principal = Depends(tenant_admin_scope),
                            db: AsyncSession = DB):
    try:
        adapter_for(body.kind, body.config)
    except KeyError as e:
        raise HTTPException(422, f"Missing config field: {e}") from None
    c = DatabaseConnection(tenant_id=p.tenant_id, name=body.name, kind=body.kind, permissions=body.permissions,
                           encrypted_config=encrypt_secret(json.dumps(body.config)))
    db.add(c)
    await db.flush()
    await audit(db, request, p, "create", "database_connection", c.id, kind=body.kind)
    await db.commit()
    return c


@router.post("/{conn_id}/test")
async def test_connection(conn_id: str, p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    c = (await db.execute(select(DatabaseConnection).where(DatabaseConnection.tenant_id == p.tenant_id,
                                                           DatabaseConnection.id == conn_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Connection not found")
    ok, message = await adapter_for(c.kind, json.loads(decrypt_secret(c.encrypted_config))).test()
    c.last_tested_at, c.last_test_ok = datetime.now(UTC), ok
    await db.commit()
    return {"ok": ok, "message": message}


@router.delete("/{conn_id}", status_code=204)
async def delete_connection(conn_id: str, request: Request, p: Principal = Depends(tenant_admin_scope),
                            db: AsyncSession = DB):
    c = (await db.execute(select(DatabaseConnection).where(DatabaseConnection.tenant_id == p.tenant_id,
                                                           DatabaseConnection.id == conn_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Connection not found")
    await db.delete(c)
    await audit(db, request, p, "delete", "database_connection", conn_id)
    await db.commit()
