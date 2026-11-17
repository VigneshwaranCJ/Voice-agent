"""Business data the agents read (industry tables). Tenant-scoped CRUD for the dashboard."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DB, Principal, tenant_admin_scope, tenant_scope
from app.industries.healthcare.models import Department, Doctor, DoctorSlot
from app.industries.real_estate.models import Property, SalesExecutive

router = APIRouter(prefix="/data", tags=["business-data"])


class PropertyIn(BaseModel):
    name: str
    project: str = ""
    property_type: str = Field(pattern=r"^(apartment|villa|plot)$")
    bhk: int | None = None
    city: str
    locality: str
    price_min: int = Field(gt=0)
    price_max: int = Field(gt=0)
    area_sqft: float | None = None
    amenities: list[str] = []
    status: str = "available"
    units_available: int = 0
    possession: str = ""
    description: str = ""


def _row(obj, fields: list[str]) -> dict:
    return {f: getattr(obj, f) for f in ["id", *fields]}


PROP_FIELDS = list(PropertyIn.model_fields)


@router.get("/properties")
async def list_properties(p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    rows = (await db.execute(select(Property).where(Property.tenant_id == p.tenant_id).order_by(Property.city))).scalars().all()
    return [_row(r, PROP_FIELDS) for r in rows]


@router.post("/properties", status_code=201)
async def create_property(body: PropertyIn, p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    prop = Property(tenant_id=p.tenant_id, **body.model_dump())
    db.add(prop)
    await db.commit()
    return _row(prop, PROP_FIELDS)


@router.put("/properties/{pid}")
async def update_property(pid: str, body: PropertyIn, p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    prop = (await db.execute(select(Property).where(Property.tenant_id == p.tenant_id, Property.id == pid))).scalar_one_or_none()
    if not prop:
        raise HTTPException(404, "Property not found")
    for k, v in body.model_dump().items():
        setattr(prop, k, v)
    await db.commit()
    return _row(prop, PROP_FIELDS)


@router.get("/sales-executives")
async def list_execs(p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    rows = (await db.execute(select(SalesExecutive).where(SalesExecutive.tenant_id == p.tenant_id))).scalars().all()
    return [_row(r, ["name", "phone", "localities", "is_active"]) for r in rows]


@router.get("/departments")
async def list_departments(p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    rows = (await db.execute(select(Department).where(Department.tenant_id == p.tenant_id))).scalars().all()
    return [_row(r, ["name", "description", "location", "phone"]) for r in rows]


class DoctorIn(BaseModel):
    name: str
    department_id: str
    specialization: str
    qualifications: str = ""
    languages: list[str] = []
    consultation_fee: int = 0


@router.get("/doctors")
async def list_doctors(p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    rows = (await db.execute(select(Doctor).where(Doctor.tenant_id == p.tenant_id))).unique().scalars().all()
    out = []
    now = datetime.now(UTC)
    for d in rows:
        free = len((await db.execute(select(DoctorSlot.id).where(
            DoctorSlot.tenant_id == p.tenant_id, DoctorSlot.doctor_id == d.id, DoctorSlot.is_booked.is_(False),
            DoctorSlot.starts_at >= now))).all())
        out.append({**_row(d, ["name", "specialization", "qualifications", "languages", "consultation_fee"]),
                    "department": d.department.name if d.department else None, "free_slots": free})
    return out


@router.post("/doctors", status_code=201)
async def create_doctor(body: DoctorIn, p: Principal = Depends(tenant_admin_scope), db: AsyncSession = DB):
    dept = (await db.execute(select(Department).where(Department.tenant_id == p.tenant_id,
                                                      Department.id == body.department_id))).scalar_one_or_none()
    if not dept:
        raise HTTPException(422, "Unknown department")
    d = Doctor(tenant_id=p.tenant_id, **body.model_dump())
    db.add(d)
    await db.commit()
    return {"id": d.id}


class SlotGenIn(BaseModel):
    days: int = Field(default=7, ge=1, le=60)
    start_hour: int = Field(default=10, ge=0, le=23)
    end_hour: int = Field(default=17, ge=1, le=24)
    minutes: int = Field(default=20, ge=5, le=120)
    timezone: str = "Asia/Kolkata"


@router.post("/doctors/{doctor_id}/slots/generate")
async def generate_slots(doctor_id: str, body: SlotGenIn, p: Principal = Depends(tenant_admin_scope),
                         db: AsyncSession = DB):
    d = (await db.execute(select(Doctor).where(Doctor.tenant_id == p.tenant_id, Doctor.id == doctor_id))).unique().scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Doctor not found")
    n = add_slots(db, p.tenant_id, d.id, body.days, body.start_hour, body.end_hour, body.minutes, body.timezone)
    await db.commit()
    return {"created": n}


def add_slots(db: AsyncSession, tenant_id: str, doctor_id: str, days: int, start_hour: int, end_hour: int,
              minutes: int, tz: str = "Asia/Kolkata", skip_sunday: bool = True) -> int:
    zone = ZoneInfo(tz)
    today = datetime.now(zone).date()
    n = 0
    for i in range(days):
        day = today + timedelta(days=i)
        if skip_sunday and day.weekday() == 6:
            continue
        t = datetime(day.year, day.month, day.day, start_hour, tzinfo=zone)
        end = datetime(day.year, day.month, day.day, end_hour % 24, tzinfo=zone)
        while t + timedelta(minutes=minutes) <= end:
            db.add(DoctorSlot(tenant_id=tenant_id, doctor_id=doctor_id, starts_at=t.astimezone(UTC),
                              ends_at=(t + timedelta(minutes=minutes)).astimezone(UTC)))
            t += timedelta(minutes=minutes)
            n += 1
    return n
