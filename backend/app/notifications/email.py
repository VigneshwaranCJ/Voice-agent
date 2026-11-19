"""Email alerts to a business's admins: a new lead, or a call handed to a person.

Real SMTP only. When SMTP isn't configured nothing is sent (and the dashboard says so); there is no fake success.
Alerts run in the background on their own database session, so a slow or failing mail server never delays or
breaks a call.
"""

import asyncio
import smtplib
import ssl
from email.message import EmailMessage

from sqlalchemy import select

from app.core.config import get_settings
from app.core.logging import log

_tasks: set[asyncio.Task] = set()  # keep references so background sends aren't garbage-collected


class EmailNotConfigured(RuntimeError):
    pass


def dashboard_url(path: str = "") -> str:
    s = get_settings()
    base = s.public_base_url or next((o for o in s.cors_origins if "localhost" not in o and "127.0.0.1" not in o), "")
    return f"{base.rstrip('/')}{path}" if base else ""


def _send_sync(to: list[str], subject: str, body: str) -> None:
    s = get_settings()
    if not s.email_configured:
        raise EmailNotConfigured("Email is not configured on the server (set SMTP_HOST and SMTP_FROM)")
    msg = EmailMessage()
    msg["From"] = s.smtp_from
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(body)
    ctx = ssl.create_default_context()
    if s.smtp_security == "ssl":
        server = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=20, context=ctx)
    else:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20)
    with server:
        if s.smtp_security == "starttls":
            server.starttls(context=ctx)
        if s.smtp_username:
            server.login(s.smtp_username, s.smtp_password or "")
        server.send_message(msg)


async def send_email(to: list[str], subject: str, body: str) -> None:
    """Send now (raises on failure). Used by the dashboard's test button."""
    await asyncio.to_thread(_send_sync, to, subject, body)


async def admin_emails(db, tenant_id: str) -> list[str]:
    from app.models import User

    rows = await db.execute(select(User.email).where(User.tenant_id == tenant_id, User.is_active.is_(True),
                                                     User.role == "tenant_admin"))
    return [e for (e,) in rows.all()]


def notify_admins(tenant_id: str, subject: str, body: str) -> None:
    """Fire-and-forget alert to the business's active admins. No-op when email isn't configured."""
    if not get_settings().email_configured:
        return

    async def run():
        from app.core.database import SessionLocal

        try:
            async with SessionLocal() as db:
                to = await admin_emails(db, tenant_id)
            if to:
                await send_email(to, subject, body)
                log.info("email_alert_sent", tenant_id=tenant_id, recipients=len(to), subject=subject)
        except Exception as e:  # never let an alert break anything
            log.warning("email_alert_failed", tenant_id=tenant_id, error=str(e)[:300])

    try:
        task = asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def lead_alert(tenant_id: str, *, name: str, phone: str | None, interest: str, budget: str | None = None) -> None:
    link = dashboard_url("/follow-ups")
    lines = [f"Name: {name or 'Not given'}", f"Phone: {phone or 'Not given'}", f"Interest: {interest or '-'}"]
    if budget:
        lines.append(f"Budget: {budget}")
    body = "The AI agent captured a new lead.\n\n" + "\n".join(lines)
    body += f"\n\nAssign and follow up: {link}" if link else "\n\nOpen Follow-ups in the dashboard to assign it."
    notify_admins(tenant_id, f"New lead: {name or phone or 'caller'}", body)


def escalation_alert(tenant_id: str, *, reason: str, priority: str, summary: str) -> None:
    link = dashboard_url("/follow-ups?tab=escalations")
    body = (f"A caller was handed to a person.\n\nReason: {reason.replace('_', ' ')}\nPriority: {priority}\n"
            f"Summary: {summary or '-'}")
    body += f"\n\nAssign and resolve: {link}" if link else "\n\nOpen Follow-ups > Escalations in the dashboard."
    tag = "URGENT: " if priority in ("critical", "high") else ""
    notify_admins(tenant_id, f"{tag}Call needs a person ({reason.replace('_', ' ')})", body)
