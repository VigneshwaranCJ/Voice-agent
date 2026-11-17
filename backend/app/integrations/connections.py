"""External business database / API adapters.

Phase 1 provides secure storage + connectivity tests. Phase 3 adds query tools that run admin-defined,
parameterised, read-only queries through these adapters.
"""

import asyncio
from typing import Protocol

import httpx


class ConnectionAdapter(Protocol):
    async def test(self) -> tuple[bool, str]: ...


class PostgresAdapter:
    def __init__(self, cfg: dict):
        self.dsn = cfg.get("dsn") or (
            f"postgresql://{cfg['user']}:{cfg['password']}@{cfg['host']}:{cfg.get('port', 5432)}/{cfg['database']}")

    async def test(self) -> tuple[bool, str]:
        import asyncpg

        try:
            conn = await asyncio.wait_for(asyncpg.connect(self.dsn), timeout=8)
            version = await conn.fetchval("select version()")
            await conn.close()
            return True, str(version)[:120]
        except Exception as e:
            return False, f"{type(e).__name__}: {str(e)[:200]}"


class MySQLAdapter:
    def __init__(self, cfg: dict):
        self.cfg = cfg

    async def test(self) -> tuple[bool, str]:
        try:
            import aiomysql  # optional dependency
        except ImportError:
            return False, "MySQL driver (aiomysql) not installed on this server"
        try:
            conn = await asyncio.wait_for(aiomysql.connect(
                host=self.cfg["host"], port=int(self.cfg.get("port", 3306)), user=self.cfg["user"],
                password=self.cfg["password"], db=self.cfg["database"]), timeout=8)
            conn.close()
            return True, "Connected"
        except Exception as e:
            return False, f"{type(e).__name__}: {str(e)[:200]}"


class RestApiAdapter:
    def __init__(self, cfg: dict):
        self.base_url = cfg["base_url"].rstrip("/")
        self.health_path = cfg.get("health_path", "/")
        self.headers = {}
        if cfg.get("api_key"):
            self.headers[cfg.get("api_key_header", "Authorization")] = cfg["api_key"]

    async def test(self) -> tuple[bool, str]:
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                r = await c.get(f"{self.base_url}{self.health_path}", headers=self.headers)
            return r.status_code < 400, f"HTTP {r.status_code}"
        except Exception as e:
            return False, f"{type(e).__name__}: {str(e)[:200]}"


def adapter_for(kind: str, cfg: dict) -> ConnectionAdapter:
    return {"postgresql": PostgresAdapter, "mysql": MySQLAdapter, "rest_api": RestApiAdapter}[kind](cfg)
