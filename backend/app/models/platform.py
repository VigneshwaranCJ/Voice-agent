"""Tenants, users, business profiles, agents, voice and integration configuration."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin


class Tenant(IdMixin, TimestampMixin, Base):
    __tablename__ = "tenants"
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    industry: Mapped[str] = mapped_column(String(40))  # real_estate | healthcare | hospitality | custom ...
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)  # data retention, recording consent, etc.

    profile: Mapped["BusinessProfile | None"] = relationship(back_populates="tenant", uselist=False)


class Role(IdMixin, Base):
    __tablename__ = "roles"
    name: Mapped[str] = mapped_column(String(40), unique=True)  # platform_admin | tenant_admin | tenant_agent
    description: Mapped[str] = mapped_column(String(200), default="")
    permissions: Mapped[list] = mapped_column(JSON, default=list)


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"
    # tenant_id is nullable only for platform admins.
    tenant_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(40), ForeignKey("roles.name"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BusinessProfile(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "business_profiles"
    __table_args__ = (UniqueConstraint("tenant_id"),)
    display_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    website: Mapped[str] = mapped_column(String(200), default="")
    timezone: Mapped[str] = mapped_column(String(60), default="Asia/Kolkata")
    operating_hours: Mapped[dict] = mapped_column(JSON, default=dict)
    locations: Mapped[list] = mapped_column(JSON, default=list)
    services: Mapped[list] = mapped_column(JSON, default=list)
    policies: Mapped[dict] = mapped_column(JSON, default=dict)
    escalation_contacts: Mapped[list] = mapped_column(JSON, default=list)

    tenant: Mapped[Tenant] = relationship(back_populates="profile")


class SupportedLanguage(Base):
    __tablename__ = "supported_languages"
    code: Mapped[str] = mapped_column(String(10), primary_key=True)  # ta-IN
    name: Mapped[str] = mapped_column(String(60))
    stt_supported: Mapped[bool] = mapped_column(Boolean, default=True)
    tts_supported: Mapped[bool] = mapped_column(Boolean, default=True)


class VoiceProfile(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "voice_profiles"
    name: Mapped[str] = mapped_column(String(100))
    tts_model: Mapped[str] = mapped_column(String(40), default="bulbul:v4-flash")
    # language code -> Bulbul persona id, e.g. {"en-IN": "aparna_en_companion", "ta-IN": "gokul_ta_narration"}
    speakers: Mapped[dict] = mapped_column(JSON, default=dict)
    pace: Mapped[float] = mapped_column(Float, default=1.0)
    temperature: Mapped[float] = mapped_column(Float, default=0.6)
    sample_rate: Mapped[int] = mapped_column(Integer, default=24000)


class Agent(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "agents"
    name: Mapped[str] = mapped_column(String(100))
    industry: Mapped[str] = mapped_column(String(40))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    voice_profile_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("voice_profiles.id", ondelete="SET NULL"))
    default_language: Mapped[str] = mapped_column(String(10), default="en-IN")
    languages: Mapped[list] = mapped_column(JSON, default=lambda: ["en-IN", "ta-IN"])
    # Allows unauthenticated web-widget sessions for this agent (website channel).
    public_widget_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    voice_profile: Mapped[VoiceProfile | None] = relationship(lazy="joined")
    configurations: Mapped[list["AgentConfiguration"]] = relationship(
        back_populates="agent", order_by="AgentConfiguration.version.desc()", cascade="all, delete-orphan"
    )


class AgentConfiguration(IdMixin, TenantMixin, TimestampMixin, Base):
    """Versioned behaviour config. The highest version with is_active=True is live."""

    __tablename__ = "agent_configurations"
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    persona_name: Mapped[str] = mapped_column(String(60), default="Priya")
    personality: Mapped[str] = mapped_column(Text, default="")
    system_instructions: Mapped[str] = mapped_column(Text, default="")
    greeting: Mapped[dict] = mapped_column(JSON, default=dict)  # language -> greeting text
    enabled_tools: Mapped[list] = mapped_column(JSON, default=list)
    workflows: Mapped[dict] = mapped_column(JSON, default=dict)
    escalation_policy: Mapped[dict] = mapped_column(JSON, default=dict)
    llm_settings: Mapped[dict] = mapped_column(JSON, default=dict)

    agent: Mapped[Agent] = relationship(back_populates="configurations")


class DatabaseConnection(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "database_connections"
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(20))  # postgresql | mysql | rest_api
    # Encrypted (Fernet) DSN / base URL + credentials. Never returned by the API.
    encrypted_config: Mapped[str] = mapped_column(Text)
    permissions: Mapped[str] = mapped_column(String(20), default="read")  # read | read_write
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)


class ToolDefinition(IdMixin, TimestampMixin, Base):
    """Catalogue of tools. tenant_id NULL = built-in tool shipped by an industry module."""

    __tablename__ = "tool_definitions"
    __table_args__ = (UniqueConstraint("tenant_id", "name"),)
    tenant_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    industry: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text)
    parameters_schema: Mapped[dict] = mapped_column(JSON, default=dict)
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)
    is_write: Mapped[bool] = mapped_column(Boolean, default=False)
