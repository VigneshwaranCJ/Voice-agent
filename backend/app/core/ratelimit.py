"""Simple per-client fixed-window rate limiter (in-process). Use Redis-backed limits for multi-instance deploys.

The client key is `request.client.host`. Behind nginx this is only the real caller's IP when uvicorn runs
with `--proxy-headers --forwarded-allow-ips=<proxy>` (see backend.Dockerfile) and the backend port is not
reachable directly; otherwise every caller shares the proxy's IP and one bucket.
"""

import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, per_minute: int = 120):
        super().__init__(app)
        self.per_minute = per_minute
        self.window = 0
        self.counts: dict[str, int] = {}  # only the current window is kept, so memory is bounded

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/") and request.scope.get("type") == "http":
            window = int(time.time() // 60)
            if window != self.window:
                self.window, self.counts = window, {}
            key = request.client.host if request.client else "anon"
            count = self.counts.get(key, 0) + 1
            self.counts[key] = count
            if count > self.per_minute:
                return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429, headers={"Retry-After": "60"})
        return await call_next(request)
