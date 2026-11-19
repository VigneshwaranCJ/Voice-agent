"""Entry point for Windows IIS hosting through HttpPlatformHandler (see web.config next to this file).

IIS starts `python -m serve` and passes the port to listen on in HTTP_PLATFORM_PORT (HttpPlatformHandler,
web.config) or ASPNETCORE_PORT (ASP.NET Core Module, web.ancm.config). The backend and the built dashboard
run in this one process: settings come from the .env file in this folder.

On start, platform admins are created from .env pairs (idempotent; existing users are left untouched):

    BOOTSTRAP_ADMIN_EMAIL=...      BOOTSTRAP_ADMIN_PASSWORD=...
    BOOTSTRAP_ADMIN_EMAIL_2=...    BOOTSTRAP_ADMIN_PASSWORD_2=...   (up to _10)

Remove the passwords from .env once each admin has signed in.
"""

import asyncio
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.chdir(HERE)  # relative paths in .env (database file, FRONTEND_DIR) resolve against this folder
(HERE / "App_Data" / "logs").mkdir(parents=True, exist_ok=True)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(HERE / ".env")

MAX_BOOTSTRAP_ADMINS = 10


def _admin_pairs() -> list[tuple[str, str, str]]:
    """(suffix, email, password) for every BOOTSTRAP_ADMIN_EMAIL[_n] that has a matching password."""
    pairs = []
    for n in range(1, MAX_BOOTSTRAP_ADMINS + 1):
        suffix = "" if n == 1 else f"_{n}"
        email = (os.getenv(f"BOOTSTRAP_ADMIN_EMAIL{suffix}") or "").strip().lower()
        password = os.getenv(f"BOOTSTRAP_ADMIN_PASSWORD{suffix}") or ""
        if email and password:
            pairs.append((suffix, email, password))
    return pairs


async def _bootstrap_admins() -> None:
    pairs = _admin_pairs()
    if not pairs:
        return
    from app.bootstrap import MIN_PASSWORD, bootstrap
    from app.core.database import create_all, engine
    from app.core.logging import log

    try:
        await create_all()
        for suffix, email, password in pairs:
            if len(password) < MIN_PASSWORD:
                log.error("bootstrap_admin_skipped", email=email,
                          reason=f"BOOTSTRAP_ADMIN_PASSWORD{suffix} must be at least {MIN_PASSWORD} characters")
                continue
            created = await bootstrap(email, password)
            log.info("bootstrap_admin", created=created, email=email)
    finally:
        await engine.dispose()  # the server starts its own event loop; don't carry pooled connections over


def main() -> None:
    asyncio.run(_bootstrap_admins())

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",  # IIS forwards to this port; it is not reachable from outside
        # HttpPlatformHandler passes HTTP_PLATFORM_PORT; the ASP.NET Core Module (web.ancm.config) passes ASPNETCORE_PORT.
        port=int(os.getenv("HTTP_PLATFORM_PORT") or os.getenv("ASPNETCORE_PORT") or "8000"),
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
        ws="websockets",
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )


if __name__ == "__main__":
    main()
