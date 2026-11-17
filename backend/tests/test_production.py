from cryptography.fernet import Fernet
from sqlalchemy import select

from app.bootstrap import bootstrap
from app.core.config import Settings
from app.models import Role, User


def _settings(**kw) -> Settings:
    base = dict(environment="production", jwt_secret="x" * 48, encryption_key=Fernet.generate_key().decode(),
                database_url="postgresql+asyncpg://u:p@db/voicecare", cors_origins=["https://app.example.com"],
                sarvam_api_key="k", redis_url="redis://r:6379/0")
    return Settings(_env_file=None, **{**base, **kw})


def test_good_production_config_passes():
    assert _settings().production_problems() == ([], [])


def test_unsafe_production_config_is_rejected():
    errors, _ = _settings(jwt_secret="dev-only-change-me", encryption_key="nope",
                          database_url="sqlite+aiosqlite:///./x.db").production_problems()
    assert len(errors) == 3


def test_production_warnings():
    _, warnings = _settings(cors_origins=["http://localhost:5173"], sarvam_api_key=None, redis_url=None).production_problems()
    assert len(warnings) == 3


async def test_bootstrap_creates_admin_once(db):
    assert await bootstrap("owner@example.com", "a-long-password-123")
    assert not await bootstrap("owner@example.com", "another-password-456")  # idempotent
    u = (await db.execute(select(User).where(User.email == "owner@example.com"))).scalar_one()
    assert u.role == "platform_admin" and u.tenant_id is None
    assert (await db.execute(select(Role).where(Role.name == "platform_admin"))).scalar_one()
