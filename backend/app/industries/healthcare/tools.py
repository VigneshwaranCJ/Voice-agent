from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.core.timeutil import as_utc, local_str
from app.industries.healthcare.models import Department, Doctor, DoctorSlot
from app.models import Appointment
from app.tools.common import IdentifyCustomerArgs, TransferArgs, create_escalation, identify_customer, normalize_phone
from app.tools.registry import ToolContext, tool

IND = "healthcare"


def _doc(d: Doctor) -> dict:
    return {"doctor_id": d.id, "name": d.name, "specialization": d.specialization,
            "department": d.department.name if d.department else None, "qualifications": d.qualifications,
            "languages": d.languages, "consultation_fee_inr": d.consultation_fee}


class SearchDoctorsArgs(BaseModel):
    specialization: str | None = Field(default=None, description="e.g. cardiologist, orthopedic, pediatrician")
    department: str | None = None
    name: str | None = None


@tool("search_doctors", "Find doctors by specialization, department or name.", SearchDoctorsArgs, industry=IND)
async def search_doctors(ctx: ToolContext, a: SearchDoctorsArgs) -> dict:
    q = select(Doctor).join(Department).where(Doctor.tenant_id == ctx.tenant_id, Doctor.is_active.is_(True))
    terms = [t for t in (a.specialization, a.department) if t]
    for t in terms:
        stem = t.lower().strip()[:6]  # "cardiologist" ~ "cardiology"
        q = q.where(or_(func.lower(Doctor.specialization).contains(stem), func.lower(Department.name).contains(stem)))
    if a.name:
        q = q.where(func.lower(Doctor.name).contains(a.name.lower().replace("dr.", "").strip()))
    rows = (await ctx.db.execute(q.limit(5))).scalars().unique().all()
    return {"ok": True, "count": len(rows), "doctors": [_doc(d) for d in rows]}


class DeptArgs(BaseModel):
    department: str


@tool("get_department_details", "Get a hospital department's description, location and phone.", DeptArgs, industry=IND)
async def get_department_details(ctx: ToolContext, a: DeptArgs) -> dict:
    stem = a.department.lower().strip()[:6]
    d = (await ctx.db.execute(select(Department).where(
        Department.tenant_id == ctx.tenant_id, func.lower(Department.name).contains(stem)))).scalars().first()
    if not d:
        return {"ok": False, "error": "Department not found."}
    return {"ok": True, "name": d.name, "description": d.description, "location": d.location, "phone": d.phone}


def _day_bounds(ctx: ToolContext, date_str: str) -> tuple[datetime, datetime]:
    tz = ZoneInfo(ctx.business_timezone)
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    start = datetime.combine(d, datetime.min.time(), tzinfo=tz)
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)


async def _free_slots(ctx: ToolContext, doctor_ids: list[str], date_str: str, limit: int = 6) -> list[dict]:
    lo, hi = _day_bounds(ctx, date_str)
    lo = max(lo, datetime.now(UTC))
    rows = (await ctx.db.execute(select(DoctorSlot, Doctor).join(Doctor, Doctor.id == DoctorSlot.doctor_id).where(
        DoctorSlot.tenant_id == ctx.tenant_id, DoctorSlot.doctor_id.in_(doctor_ids), DoctorSlot.is_booked.is_(False),
        DoctorSlot.starts_at >= lo, DoctorSlot.starts_at < hi).order_by(DoctorSlot.starts_at).limit(limit))).all()
    return [{"slot_id": s.id, "doctor_id": d.id, "doctor": d.name,
             "time": local_str(s.starts_at, ctx.business_timezone, "%I:%M %p")} for s, d in rows]


class ScheduleArgs(BaseModel):
    doctor_id: str
    date: str = Field(description="YYYY-MM-DD")


@tool("get_doctor_schedule", "Get a doctor's free consultation slots on a date.", ScheduleArgs, industry=IND)
async def get_doctor_schedule(ctx: ToolContext, a: ScheduleArgs) -> dict:
    doc = (await ctx.db.execute(select(Doctor).where(Doctor.tenant_id == ctx.tenant_id, Doctor.id == a.doctor_id))).scalar_one_or_none()
    if not doc:
        return {"ok": False, "error": "Doctor not found."}
    try:
        slots = await _free_slots(ctx, [doc.id], a.date)
    except ValueError:
        return {"ok": False, "error": "Date must be YYYY-MM-DD."}
    return {"ok": True, "doctor": doc.name, "date": a.date, "free_slots": slots}


class AvailabilityArgs(BaseModel):
    date: str = Field(description="YYYY-MM-DD")
    doctor_id: str | None = None
    specialization: str | None = None


@tool("check_appointment_availability", "Check free appointment slots on a date for a doctor or a specialization.",
      AvailabilityArgs, industry=IND)
async def check_appointment_availability(ctx: ToolContext, a: AvailabilityArgs) -> dict:
    if a.doctor_id:
        ids = [a.doctor_id]
    elif a.specialization:
        ids = [d["doctor_id"] for d in (await search_doctors(ctx, SearchDoctorsArgs(specialization=a.specialization)))["doctors"]]
    else:
        return {"ok": False, "error": "Provide doctor_id or specialization."}
    if not ids:
        return {"ok": True, "free_slots": [], "note": "No doctor found for that specialization."}
    try:
        slots = await _free_slots(ctx, ids, a.date)
    except ValueError:
        return {"ok": False, "error": "Date must be YYYY-MM-DD."}
    return {"ok": True, "date": a.date, "free_slots": slots}


class BookArgs(BaseModel):
    slot_id: str
    patient_name: str
    phone: str
    reason: str | None = Field(default=None, description="Short non-diagnostic reason for visit, as the caller said it.")
    confirmed: bool = Field(default=False, description="True only after the caller explicitly confirmed doctor, date, time and name.")


@tool("book_appointment", "Book a consultation slot. Requires explicit caller confirmation.", BookArgs,
      industry=IND, requires_confirmation=True, is_write=True)
async def book_appointment(ctx: ToolContext, a: BookArgs) -> dict:
    phone = normalize_phone(a.phone)
    if len(phone) != 10:
        return {"ok": False, "error": "Need a valid 10-digit mobile number."}
    slot = (await ctx.db.execute(select(DoctorSlot).where(
        DoctorSlot.tenant_id == ctx.tenant_id, DoctorSlot.id == a.slot_id).with_for_update())).scalar_one_or_none()
    if not slot:
        return {"ok": False, "error": "Slot not found."}
    if slot.is_booked or as_utc(slot.starts_at) < datetime.now(UTC):
        return {"ok": False, "error": "That slot is no longer available. Offer other slots."}
    doc = (await ctx.db.execute(select(Doctor).where(Doctor.tenant_id == ctx.tenant_id, Doctor.id == slot.doctor_id))).scalar_one()
    if not ctx.state.customer_id:
        await identify_customer(ctx, IdentifyCustomerArgs(phone=phone, name=a.patient_name))
    appt = Appointment(tenant_id=ctx.tenant_id, customer_id=ctx.state.customer_id, conversation_id=ctx.conversation_id,
                       kind="doctor_consultation", resource_type="doctor", resource_id=doc.id,
                       starts_at=as_utc(slot.starts_at), ends_at=as_utc(slot.ends_at), contact_name=a.patient_name,
                       contact_phone=phone, notes=a.reason or "")
    ctx.db.add(appt)
    await ctx.db.flush()
    slot.is_booked, slot.appointment_id = True, appt.id
    await ctx.db.commit()
    return {"ok": True, "appointment_id": appt.id, "doctor": doc.name,
            "when": local_str(slot.starts_at, ctx.business_timezone), "fee_inr": doc.consultation_fee}


async def _find_appt(ctx: ToolContext, appointment_id: str | None, phone: str) -> Appointment | None:
    """Authorization: the caller must supply the phone number the booking was made with."""
    q = select(Appointment).where(Appointment.tenant_id == ctx.tenant_id, Appointment.contact_phone == phone,
                                  Appointment.status == "booked", Appointment.kind == "doctor_consultation")
    if appointment_id:
        q = q.where(Appointment.id == appointment_id)
    return (await ctx.db.execute(q.order_by(Appointment.starts_at))).scalars().first()


class CancelArgs(BaseModel):
    phone: str = Field(description="Mobile number used for the booking.")
    appointment_id: str | None = None
    confirmed: bool = False


@tool("cancel_appointment", "Cancel a booked appointment (caller must give the booking mobile number). "
      "Requires confirmation.", CancelArgs, industry=IND, requires_confirmation=True, is_write=True)
async def cancel_appointment(ctx: ToolContext, a: CancelArgs) -> dict:
    appt = await _find_appt(ctx, a.appointment_id, normalize_phone(a.phone))
    if not appt:
        return {"ok": False, "error": "No matching booked appointment for that number."}
    appt.status = "cancelled"
    slot = (await ctx.db.execute(select(DoctorSlot).where(
        DoctorSlot.tenant_id == ctx.tenant_id, DoctorSlot.appointment_id == appt.id))).scalar_one_or_none()
    if slot:
        slot.is_booked, slot.appointment_id = False, None
    await ctx.db.commit()
    return {"ok": True, "cancelled_appointment_id": appt.id, "was_on": local_str(appt.starts_at, ctx.business_timezone)}


class RescheduleArgs(BaseModel):
    phone: str
    new_slot_id: str
    appointment_id: str | None = None
    confirmed: bool = False


@tool("reschedule_appointment", "Move a booked appointment to a new free slot. Requires confirmation.",
      RescheduleArgs, industry=IND, requires_confirmation=True, is_write=True)
async def reschedule_appointment(ctx: ToolContext, a: RescheduleArgs) -> dict:
    phone = normalize_phone(a.phone)
    appt = await _find_appt(ctx, a.appointment_id, phone)
    if not appt:
        return {"ok": False, "error": "No matching booked appointment for that number."}
    new = (await ctx.db.execute(select(DoctorSlot).where(
        DoctorSlot.tenant_id == ctx.tenant_id, DoctorSlot.id == a.new_slot_id))).scalar_one_or_none()
    if not new or new.is_booked or as_utc(new.starts_at) < datetime.now(UTC):
        return {"ok": False, "error": "The new slot is not available."}
    old = (await ctx.db.execute(select(DoctorSlot).where(
        DoctorSlot.tenant_id == ctx.tenant_id, DoctorSlot.appointment_id == appt.id))).scalar_one_or_none()
    if old:
        old.is_booked, old.appointment_id = False, None
    new.is_booked, new.appointment_id = True, appt.id
    appt.starts_at, appt.ends_at, appt.resource_id = as_utc(new.starts_at), as_utc(new.ends_at), new.doctor_id
    await ctx.db.commit()
    return {"ok": True, "appointment_id": appt.id, "new_time": local_str(new.starts_at, ctx.business_timezone)}


@tool("transfer_to_hospital_staff", "Transfer the caller to hospital staff (front desk, a department, or emergency).",
      TransferArgs, industry=IND, is_write=True)
async def transfer_to_hospital_staff(ctx: ToolContext, a: TransferArgs) -> dict:
    priority = "critical" if a.reason == "emergency" else "normal"
    rec = await create_escalation(ctx, a.reason, a.summary, priority, a.department or "front_desk")
    return {"ok": True, "escalation_id": rec.id, "message": "Hospital staff notified."}


TOOLS = ["search_doctors", "get_doctor_schedule", "get_department_details", "check_appointment_availability",
         "book_appointment", "cancel_appointment", "reschedule_appointment", "transfer_to_hospital_staff"]
