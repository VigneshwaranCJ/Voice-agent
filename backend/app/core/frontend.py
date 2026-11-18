"""Serve the built dashboard (frontend/dist) from the API process.

Used on hosts that can't run a separate web server in front of the backend, such as IIS with
HttpPlatformHandler. Docker deployments keep using nginx and leave FRONTEND_DIR unset.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

# Paths owned by the backend: never answered with the dashboard's index.html.
_BACKEND_SEGMENTS = {"api", "health", "docs", "redoc", "openapi.json"}


def mount_frontend(app: FastAPI, directory: str | Path) -> None:
    """Serve files from `directory`, falling back to index.html for client-side routes.

    Register this after all API routes, because the catch-all route would otherwise shadow them.
    """
    root = Path(directory).resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"FRONTEND_DIR has no index.html: {root}")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        if path.split("/", 1)[0] in _BACKEND_SEGMENTS:
            raise HTTPException(status_code=404)
        if path:
            candidate = (root / path).resolve()
            # Only files inside the dashboard folder; blocks ../ traversal and absolute paths.
            if candidate.is_relative_to(root) and candidate.is_file() and candidate.name != "web.config":
                # Vite fingerprints everything under assets/, so those files never change.
                immutable = candidate.is_relative_to(root / "assets")
                headers = {"Cache-Control": "public, max-age=31536000, immutable" if immutable else "no-cache"}
                return FileResponse(candidate, headers=headers)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
