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


MAX_ENV_ADMINS = 10


def admin_pairs_from_env() -> list[tuple[str, str, str]]:
    """(suffix, email, password) for each BOOTSTRAP_ADMIN_EMAIL[_n] / BOOTSTRAP_ADMIN_PASSWORD[_n] pair (n = 2..10)."""
    pairs = []
    for n in range(1, MAX_ENV_ADMINS + 1):
        suffix = "" if n == 1 else f"_{n}"
        email = (os.getenv(f"BOOTSTRAP_ADMIN_EMAIL{suffix}") or "").strip().lower()
        password = os.getenv(f"BOOTSTRAP_ADMIN_PASSWORD{suffix}") or ""
        if email and password:
            pairs.append((suffix, email, password))
    return pairs


async def bootstrap_admins_from_env() -> None:
    """Create the platform admins listed in the environment (idempotent: existing users are never changed).
    Used by hosting entrypoints that have no shell for `python -m app.bootstrap`. Tables must already exist."""
    from app.core.logging import log

    for suffix, email, password in admin_pairs_from_env():
        if len(password) < MIN_PASSWORD:
            log.error("bootstrap_admin_skipped", email=email,
                      reason=f"BOOTSTRAP_ADMIN_PASSWORD{suffix} must be at least {MIN_PASSWORD} characters")
            continue
        created = await bootstrap(email, password)
        log.info("bootstrap_admin", created=created, email=email)


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
