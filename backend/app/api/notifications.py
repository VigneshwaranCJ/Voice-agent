"""Email alert status and a test send, for business admins."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import DB, Principal, tenant_admin_scope
from app.models import User
from app.notifications.email import EmailNotConfigured, admin_emails, send_email

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/email")
async def email_status(p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    """Whether alerts can be sent, and who receives this business's alerts (its active admins)."""
    return {"configured": get_settings().email_configured, "recipients": await admin_emails(db, p.tenant_id)}


@router.post("/email/test")
async def email_test(p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    """Send a test email to the signed-in admin, so they can check delivery before relying on alerts."""
    me = await db.get(User, p.user_id)
    try:
        await send_email([me.email], "Test alert from your AI agent dashboard",
                         "Email alerts are working. You'll get an email like this when the agent captures a lead "
                         "or hands a call to a person.")
    except EmailNotConfigured as e:
        raise HTTPException(503, str(e)) from None
    except Exception as e:
        raise HTTPException(502, f"The mail server refused the message: {str(e)[:200]}") from None
    return {"ok": True, "sent_to": me.email}
