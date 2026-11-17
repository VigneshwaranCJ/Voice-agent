from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin


class Department(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "departments"
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    keywords: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["heart", "cardiac", "இதயம்"]


class Doctor(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "doctors"
    name: Mapped[str] = mapped_column(String(200))
    department_id: Mapped[str] = mapped_column(String(36), ForeignKey("departments.id", ondelete="CASCADE"), index=True)
    specialization: Mapped[str] = mapped_column(String(120), index=True)
    qualifications: Mapped[str] = mapped_column(String(200), default="")
    languages: Mapped[list] = mapped_column(JSON, default=list)
    consultation_fee: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    department: Mapped[Department] = relationship(lazy="joined")


class DoctorSlot(IdMixin, TenantMixin, Base):
    __tablename__ = "doctor_slots"
    doctor_id: Mapped[str] = mapped_column(String(36), ForeignKey("doctors.id", ondelete="CASCADE"), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)  # stored in UTC
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_booked: Mapped[bool] = mapped_column(Boolean, default=False)
    appointment_id: Mapped[str | None] = mapped_column(String(36))
