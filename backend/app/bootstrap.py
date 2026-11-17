"""Production bootstrap: reference data + the first platform admin (no demo businesses).

    uv run python -m app.bootstrap --email you@yourcompany.com

The password is read from BOOTSTRAP_ADMIN_PASSWORD, or prompted for (never passed on the command line,
where it would land in shell history). Safe to re-run: existing roles and users are left untouched.
"""

import argparse
import asyncio
import getpass
import os
import sys

from sqlalchemy import select

from app.core.database import SessionLocal
from app.models import User
from app.security.crypto import hash_password
from app.seed import _ensure_reference

MIN_PASSWORD = 12


async def bootstrap(email: str, password: str, full_name: str = "Platform Admin") -> bool:
    """Ensure roles/languages exist and create the platform admin. Returns False if the user already exists."""
    async with SessionLocal() as db:
        await _ensure_reference(db)
        exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if not exists:
            db.add(User(tenant_id=None, email=email, full_name=full_name, role="platform_admin",
                        password_hash=hash_password(password)))
        await db.commit()
        return not exists


def main() -> None:
    ap = argparse.ArgumentParser(description="Create reference data and the first platform admin.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--name", default="Platform Admin")
    a = ap.parse_args()
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
    if len(password) < MIN_PASSWORD:
        sys.exit(f"Password must be at least {MIN_PASSWORD} characters.")
    created = asyncio.run(bootstrap(a.email.strip().lower(), password, a.name))
    print("Platform admin created." if created else "User already exists; reference data ensured.")


if __name__ == "__main__":
    main()
