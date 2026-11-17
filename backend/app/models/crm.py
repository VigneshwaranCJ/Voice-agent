from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin


class Customer(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("tenant_id", "phone"),)
    name: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str | None] = mapped_column(String(30), index=True)
    email: Mapped[str | None] = mapped_column(String(200))
    preferred_language: Mapped[str | None] = mapped_column(String(10))
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str] = mapped_column(Text, default="")


class Lead(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "leads"
    customer_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("customers.id", ondelete="SET NULL"), index=True)
    conversation_id: Mapped[str | None] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str | None] = mapped_column(String(30))
    interest: Mapped[str] = mapped_column(Text, default="")
    budget: Mapped[str | None] = mapped_column(String(80))
    location_preference: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30), default="new")  # new | qualified | contacted | won | lost
    assigned_to: Mapped[str | None] = mapped_column(String(200))
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class Appointment(IdMixin, TenantMixin, TimestampMixin, Base):
    """Generic appointment (doctor consults, site visits, sales meetings)."""

    __tablename__ = "appointments"
    customer_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("customers.id", ondelete="SET NULL"), index=True)
    conversation_id: Mapped[str | None] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(40))  # doctor_consultation | site_visit | sales_meeting
    resource_type: Mapped[str] = mapped_column(String(40))  # doctor | property | sales_executive
    resource_id: Mapped[str] = mapped_column(String(36), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="booked")  # booked | cancelled | completed | no_show
    contact_name: Mapped[str] = mapped_column(String(200), default="")
    contact_phone: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str] = mapped_column(Text, default="")
