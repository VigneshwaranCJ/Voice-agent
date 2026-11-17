from sqlalchemy import JSON, BigInteger, Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin


class Property(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "properties"
    name: Mapped[str] = mapped_column(String(200))
    project: Mapped[str] = mapped_column(String(200), default="")
    property_type: Mapped[str] = mapped_column(String(30))  # apartment | villa | plot
    bhk: Mapped[int | None] = mapped_column(Integer)
    city: Mapped[str] = mapped_column(String(80), index=True)
    locality: Mapped[str] = mapped_column(String(120), index=True)
    price_min: Mapped[int] = mapped_column(BigInteger)  # INR
    price_max: Mapped[int] = mapped_column(BigInteger)
    area_sqft: Mapped[float | None] = mapped_column(Float)
    amenities: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30), default="available")  # available | sold_out | upcoming
    units_available: Mapped[int] = mapped_column(Integer, default=0)
    possession: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)


class SalesExecutive(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "sales_executives"
    name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(30))
    localities: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
