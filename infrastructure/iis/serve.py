"""Entry point for Windows IIS hosting through HttpPlatformHandler (see web.config next to this file).

IIS starts `python -m serve` and passes the port to listen on in HTTP_PLATFORM_PORT. The backend and the
built dashboard run in this one process: settings come from the .env file in this folder.

On first start, if BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are set in .env, the first platform
admin is created (idempotent). Remove BOOTSTRAP_ADMIN_PASSWORD from .env once you have signed in.
"""

import asyncio
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.chdir(HERE)  # relative paths in .env (database file, FRONTEND_DIR) resolve against this folder
(HERE / "App_Data" / "logs").mkdir(parents=True, exist_ok=True)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(HERE / ".env")


async def _bootstrap_admin() -> None:
    email = (os.getenv("BOOTSTRAP_ADMIN_EMAIL") or "").strip().lower()
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or ""
    if not (email and password):
        return
    from app.bootstrap import MIN_PASSWORD, bootstrap
    from app.core.database import create_all, engine
    from app.core.logging import log

    if len(password) < MIN_PASSWORD:
        log.error("bootstrap_admin_skipped", reason=f"BOOTSTRAP_ADMIN_PASSWORD must be at least {MIN_PASSWORD} characters")
        return
    try:
        await create_all()
        created = await bootstrap(email, password)
        log.info("bootstrap_admin", created=created, email=email)
    finally:
        await engine.dispose()  # the server starts its own event loop; don't carry pooled connections over


def main() -> None:
    asyncio.run(_bootstrap_admin())

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",  # IIS forwards to this port; it is not reachable from outside
        port=int(os.getenv("HTTP_PLATFORM_PORT", "8000")),
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
        ws="websockets",
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )


if __name__ == "__main__":
    main()
