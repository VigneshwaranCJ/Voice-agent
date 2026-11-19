from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

_settings = get_settings()

_engine_kwargs: dict = {}
if not _settings.is_sqlite:
    _engine_kwargs.update(pool_size=_settings.db_pool_size, max_overflow=_settings.db_max_overflow, pool_pre_ping=True)

engine = create_async_engine(_settings.database_url, **_engine_kwargs)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def create_all() -> None:
    """Dev convenience. Production uses Alembic migrations."""
    from app.models import Base  # noqa: F401  (imports all models)
    import app.industries.registry  # noqa: F401  (imports industry models)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
