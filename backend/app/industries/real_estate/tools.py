from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.industries.real_estate.models import Property, SalesExecutive
from app.models import Appointment, Lead
from app.tools.common import IdentifyCustomerArgs, identify_customer, normalize_phone
from app.tools.registry import ToolContext, tool

IND = "real_estate"


def _fmt_inr(v: int) -> str:
    if v >= 10_000_000:
        return f"₹{v / 10_000_000:.2f} crore"
    return f"₹{v / 100_000:.1f} lakh"


def _summary(p: Property) -> dict:
    return {"property_id": p.id, "name": p.name, "type": p.property_type, "bhk": p.bhk,
            "locality": p.locality, "city": p.city, "price_range": f"{_fmt_inr(p.price_min)} – {_fmt_inr(p.price_max)}",
            "status": p.status, "units_available": p.units_available}


class SearchPropertiesArgs(BaseModel):
    city: str | None = None
    locality: str | None = None
    property_type: str | None = Field(default=None, description="apartment | villa | plot")
    bhk: int | None = None
    max_budget_inr: int | None = Field(default=None, description="Upper budget in rupees, e.g. 7500000 for 75 lakh")
    min_budget_inr: int | None = None


@tool("search_properties", "Search available properties by city, locality, type, BHK and budget.",
      SearchPropertiesArgs, industry=IND)
async def search_properties(ctx: ToolContext, a: SearchPropertiesArgs) -> dict:
    q = select(Property).where(Property.tenant_id == ctx.tenant_id, Property.is_published.is_(True))
    if a.city:
        q = q.where(func.lower(Property.city) == a.city.lower().strip())
    if a.locality:
        q = q.where(func.lower(Property.locality).contains(a.locality.lower().strip()))
    if a.property_type:
        q = q.where(Property.property_type == a.property_type.lower())
    if a.bhk:
        q = q.where(Property.bhk == a.bhk)
    if a.max_budget_inr:
        q = q.where(Property.price_min <= a.max_budget_inr)
    if a.min_budget_inr:
        q = q.where(Property.price_max >= a.min_budget_inr)
    rows = (await ctx.db.execute(q.order_by(Property.price_min).limit(5))).scalars().all()
    ctx.state.collected.update({k: v for k, v in a.model_dump().items() if v is not None})
    return {"ok": True, "count": len(rows), "properties": [_summary(p) for p in rows]}


class PropertyIdArgs(BaseModel):
    property_id: str = Field(description="The property_id returned by search_properties.")


async def _get(ctx: ToolContext, pid: str) -> Property | None:
    p = (await ctx.db.execute(select(Property).where(
        Property.tenant_id == ctx.tenant_id, Property.id == pid))).scalar_one_or_none()
    if p or not pid.strip():
        return p
    # LLMs sometimes pass the property name instead of the id; accept an unambiguous name match.
    matches = (await ctx.db.execute(select(Property).where(
        Property.tenant_id == ctx.tenant_id, func.lower(Property.name).contains(pid.lower().strip())))).scalars().all()
    return matches[0] if len(matches) == 1 else None


@tool("get_property_details", "Get full specifications, amenities and possession date of a property.",
      PropertyIdArgs, industry=IND)
async def get_property_details(ctx: ToolContext, a: PropertyIdArgs) -> dict:
    p = await _get(ctx, a.property_id)
    if not p:
        return {"ok": False, "error": "Property not found. Use the exact property_id from search_properties."}
    return {"ok": True, **_summary(p), "project": p.project, "area_sqft": p.area_sqft,
            "amenities": p.amenities, "possession": p.possession, "description": p.description}


@tool("check_property_availability", "Check if units are currently available in a property.",
      PropertyIdArgs, industry=IND)
async def check_property_availability(ctx: ToolContext, a: PropertyIdArgs) -> dict:
    p = await _get(ctx, a.property_id)
    if not p:
        return {"ok": False, "error": "Property not found. Use the exact property_id from search_properties."}
    return {"ok": True, "property_id": p.id, "name": p.name, "status": p.status, "units_available": p.units_available}


@tool("get_pricing", "Get the current price range of a property.", PropertyIdArgs, industry=IND)
async def get_pricing(ctx: ToolContext, a: PropertyIdArgs) -> dict:
    p = await _get(ctx, a.property_id)
    if not p:
        return {"ok": False, "error": "Property not found. Use the exact property_id from search_properties."}
    return {"ok": True, "property_id": p.id, "name": p.name, "price_min_inr": p.price_min, "price_max_inr": p.price_max,
            "price_range": f"{_fmt_inr(p.price_min)} – {_fmt_inr(p.price_max)}",
            "note": "Final price depends on unit, floor and offers; the sales team confirms."}


async def _pick_executive(ctx: ToolContext, locality: str) -> SalesExecutive | None:
    execs = (await ctx.db.execute(select(SalesExecutive).where(
        SalesExecutive.tenant_id == ctx.tenant_id, SalesExecutive.is_active.is_(True)))).scalars().all()
    if not execs:
        return None
    matching = [e for e in execs if locality.lower() in [x.lower() for x in e.localities]] or execs
    # least-loaded among matching
    loads = {}
    for e in matching:
        loads[e.id] = (await ctx.db.execute(select(func.count()).select_from(Lead).where(
            Lead.tenant_id == ctx.tenant_id, Lead.assigned_to == e.name))).scalar_one()
    return min(matching, key=lambda e: loads[e.id])


class SiteVisitArgs(BaseModel):
    property_id: str
    date: str = Field(description="YYYY-MM-DD")
    time: str = Field(description="HH:MM 24-hour, between 09:00 and 18:00")
    name: str
    phone: str
    confirmed: bool = Field(default=False, description="True only after the caller explicitly confirmed the details.")


@tool("schedule_site_visit", "Book a site visit for a property and assign a sales executive. Requires confirmation.",
      SiteVisitArgs, industry=IND, requires_confirmation=True, is_write=True)
async def schedule_site_visit(ctx: ToolContext, a: SiteVisitArgs) -> dict:
    p = await _get(ctx, a.property_id)
    if not p:
        return {"ok": False, "error": "Property not found. Use the exact property_id from search_properties."}
    phone = normalize_phone(a.phone)
    if len(phone) != 10:
        return {"ok": False, "error": "Need a valid 10-digit mobile number."}
    try:
        tz = ZoneInfo(ctx.business_timezone)
        d = datetime.strptime(a.date, "%Y-%m-%d").date()
        t = datetime.strptime(a.time, "%H:%M").time()
    except ValueError:
        return {"ok": False, "error": "Date must be YYYY-MM-DD and time HH:MM."}
    starts = datetime.combine(d, t, tzinfo=tz)
    if starts < datetime.now(tz):
        return {"ok": False, "error": "That time is in the past."}
    if not (time(9) <= t <= time(18)):
        return {"ok": False, "error": "Site visits are between 9 AM and 6 PM."}
    if not ctx.state.customer_id:
        await identify_customer(ctx, IdentifyCustomerArgs(phone=phone, name=a.name))
    exe = await _pick_executive(ctx, p.locality)
    appt = Appointment(tenant_id=ctx.tenant_id, customer_id=ctx.state.customer_id, conversation_id=ctx.conversation_id,
                       kind="site_visit", resource_type="property", resource_id=p.id, starts_at=starts.astimezone(UTC),
                       ends_at=(starts + timedelta(hours=1)).astimezone(UTC), contact_name=a.name, contact_phone=phone,
                       notes=f"Sales executive: {exe.name if exe else 'unassigned'}")
    ctx.db.add(appt)
    await ctx.db.flush()
    ctx.db.add(Lead(tenant_id=ctx.tenant_id, customer_id=ctx.state.customer_id, conversation_id=ctx.conversation_id,
                    name=a.name, phone=phone, interest=f"Site visit: {p.name}", status="qualified",
                    location_preference=p.locality, assigned_to=exe.name if exe else None,
                    details={"property_id": p.id, "appointment_id": appt.id}))
    await ctx.db.commit()
    return {"ok": True, "appointment_id": appt.id, "property": p.name, "when": starts.strftime("%A %d %B, %I:%M %p"),
            "sales_executive": exe.name if exe else None}


class AssignArgs(BaseModel):
    locality: str
    lead_id: str | None = None


@tool("assign_sales_executive", "Find the sales executive responsible for a locality (optionally assign a lead).",
      AssignArgs, industry=IND, is_write=True)
async def assign_sales_executive(ctx: ToolContext, a: AssignArgs) -> dict:
    exe = await _pick_executive(ctx, a.locality)
    if not exe:
        return {"ok": False, "error": "No sales executive configured."}
    if a.lead_id:
        lead = (await ctx.db.execute(select(Lead).where(Lead.tenant_id == ctx.tenant_id, Lead.id == a.lead_id))).scalar_one_or_none()
        if lead:
            lead.assigned_to = exe.name
            await ctx.db.commit()
    return {"ok": True, "sales_executive": exe.name}


TOOLS = ["search_properties", "get_property_details", "check_property_availability", "get_pricing",
         "schedule_site_visit", "assign_sales_executive"]
