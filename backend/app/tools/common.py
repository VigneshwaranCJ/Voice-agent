"""Tools available to every industry."""

import re

from pydantic import BaseModel, Field
from sqlalchemy import select

from app.knowledge.retrieval import search
from app.models import Appointment, BusinessProfile, Customer, EscalationRecord, Lead
from app.tools.registry import ToolContext, tool


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


class SearchKnowledgeArgs(BaseModel):
    query: str = Field(description="What the caller wants to know, in a few keywords (English preferred).")


@tool("search_knowledge", "Search this business's documents, FAQs and policies. Use for any policy, "
      "process, facility or general question before answering.", SearchKnowledgeArgs)
async def search_knowledge(ctx: ToolContext, args: SearchKnowledgeArgs) -> dict:
    hits = await search(ctx.db, tenant_id=ctx.tenant_id, agent_id=ctx.agent_id, query=args.query, k=3)
    if not hits:
        return {"ok": True, "results": [], "note": "No matching information in the knowledge base."}
    return {"ok": True, "results": [{"source": h.title, "text": h.content[:700]} for h in hits]}


class NoArgs(BaseModel):
    pass


@tool("get_business_info", "Get the business's contact details, address/locations, operating hours and services.",
      NoArgs)
async def get_business_info(ctx: ToolContext, args: NoArgs) -> dict:
    p = (await ctx.db.execute(select(BusinessProfile).where(BusinessProfile.tenant_id == ctx.tenant_id))).scalar_one_or_none()
    if not p:
        return {"ok": False, "error": "Business profile not configured."}
    return {"ok": True, "name": p.display_name, "phone": p.phone, "email": p.email, "website": p.website,
            "operating_hours": p.operating_hours, "locations": p.locations, "services": p.services}


class IdentifyCustomerArgs(BaseModel):
    phone: str = Field(description="Caller's 10-digit mobile number.")
    name: str | None = Field(default=None, description="Caller's name, if given.")


@tool("identify_customer", "Register the caller's mobile number for this call (look up or create). Returns only "
      "whether they are new and how many records exist; it does not verify identity or reveal stored details.",
      IdentifyCustomerArgs, is_write=True)
async def identify_customer(ctx: ToolContext, args: IdentifyCustomerArgs) -> dict:
    phone = normalize_phone(args.phone)
    if len(phone) != 10:
        return {"ok": False, "error": "Please ask for a valid 10-digit mobile number."}
    cust = (await ctx.db.execute(select(Customer).where(
        Customer.tenant_id == ctx.tenant_id, Customer.phone == phone))).scalar_one_or_none()
    is_new = cust is None
    if is_new:
        cust = Customer(tenant_id=ctx.tenant_id, phone=phone, name=args.name or "",
                        preferred_language=ctx.state.language)
        ctx.db.add(cust)
        await ctx.db.flush()
    elif args.name and not cust.name:
        cust.name = args.name
    ctx.state.customer_id = cust.id
    ctx.state.collected["phone"] = phone
    if args.name:  # only what the caller told us this call; never the stored name
        ctx.state.collected["name"] = args.name
    await ctx.db.commit()

    # A phone number is NOT verification: anyone can say someone else's number. So nothing stored about
    # the customer (name, appointments, enquiries) is returned — only counts, so the agent knows to ask.
    # Sensitive actions (cancel/reschedule) re-check the phone against the booking itself.
    n_appts = len((await ctx.db.execute(select(Appointment.id).where(
        Appointment.tenant_id == ctx.tenant_id, Appointment.customer_id == cust.id,
        Appointment.status == "booked"))).scalars().all())
    n_leads = len((await ctx.db.execute(select(Lead.id).where(
        Lead.tenant_id == ctx.tenant_id, Lead.customer_id == cust.id))).scalars().all())
    return {
        "ok": True, "is_new_customer": is_new, "verified": False,
        "upcoming_appointment_count": n_appts, "previous_enquiry_count": n_leads,
        "note": "Caller is NOT verified. Do not reveal or guess any stored name, appointment or enquiry "
                "details. Ask the caller for what you need.",
    }


class CreateLeadArgs(BaseModel):
    name: str
    phone: str
    interest: str = Field(description="What the caller is looking for.")
    budget: str | None = None
    location_preference: str | None = None


@tool("create_customer_lead", "Save the caller as a sales lead after collecting name, phone and requirement.",
      CreateLeadArgs, is_write=True)
async def create_customer_lead(ctx: ToolContext, args: CreateLeadArgs) -> dict:
    phone = normalize_phone(args.phone)
    if len(phone) != 10:
        return {"ok": False, "error": "Need a valid 10-digit mobile number."}
    if not ctx.state.customer_id:
        await identify_customer(ctx, IdentifyCustomerArgs(phone=phone, name=args.name))
    lead = Lead(tenant_id=ctx.tenant_id, customer_id=ctx.state.customer_id, conversation_id=ctx.conversation_id,
                name=args.name, phone=phone, interest=args.interest, budget=args.budget,
                location_preference=args.location_preference, status="qualified" if args.budget else "new")
    ctx.db.add(lead)
    await ctx.db.commit()
    return {"ok": True, "lead_id": lead.id, "status": lead.status}


class TransferArgs(BaseModel):
    reason: str = Field(description="customer_request | unresolved | policy | verification | distress | emergency")
    summary: str = Field(description="One or two sentences summarising the caller's issue for the human executive.")
    department: str | None = None


async def create_escalation(ctx: ToolContext, reason: str, summary: str, priority: str = "normal",
                            department: str | None = None) -> EscalationRecord:
    rec = EscalationRecord(
        tenant_id=ctx.tenant_id, conversation_id=ctx.conversation_id, reason=reason, priority=priority,
        summary=summary, context={"collected": ctx.state.collected, "language": ctx.state.language,
                                  "customer_id": ctx.state.customer_id, "department": department},
    )
    ctx.db.add(rec)
    await ctx.db.commit()
    ctx.state.escalated = True
    ctx.state.escalation_reason = reason
    ctx.events.append({"type": "handoff", "reason": reason, "priority": priority, "escalation_id": rec.id,
                       "department": department})
    return rec


@tool("transfer_to_human", "Hand the call to a human executive. Use when the caller asks for a person, you "
      "cannot resolve the issue, policy requires approval, or the caller is distressed.", TransferArgs, is_write=True)
async def transfer_to_human(ctx: ToolContext, args: TransferArgs) -> dict:
    reason = args.reason if args.reason in {
        "customer_request", "unresolved", "policy", "verification", "distress", "emergency"} else "unresolved"
    priority = "critical" if reason == "emergency" else "high" if reason == "distress" else "normal"
    rec = await create_escalation(ctx, reason, args.summary, priority, args.department)
    return {"ok": True, "escalation_id": rec.id,
            "message": "A human executive has been notified and will take over. Tell the caller briefly."}


COMMON_TOOLS = ["search_knowledge", "get_business_info", "identify_customer", "create_customer_lead", "transfer_to_human"]
