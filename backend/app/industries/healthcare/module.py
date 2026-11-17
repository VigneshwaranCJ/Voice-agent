import re

from app.industries.base import GuardResult, IndustryModule
from app.industries.healthcare import tools as hc_tools
from app.tools.common import COMMON_TOOLS

# Conservative emergency detection (English, Tamil script, Tanglish, Hindi). False positives are
# acceptable here: the response only directs the caller to emergency help and alerts staff.
# Latin-script patterns are word-bounded ("fits" must not match "benefits"); a trailing `\w*` marks a
# deliberate prefix match (e.g. "suicid" → suicide/suicidal). Tamil/Devanagari use combining marks that
# break `\b`, so those patterns stay unbounded.
_EMERGENCY_LATIN = [
    r"chest pain", r"heart attack", r"can'?t breathe", r"cannot breathe", r"not breathing", r"breathless",
    r"unconscious", r"fainted", r"collapsed", r"heavy bleeding", r"bleeding (a lot|heavily)", r"stroke",
    r"seizures?", r"fits", r"accident", r"poison(ed|ing)?", r"overdosed?", r"suicid\w*", r"kill myself",
    r"severe burns?",
    r"nenju ?vali", r"moochu (vida|thinaral)", r"mayakk\w*", r"rattham", r"vibathu",
]
_EMERGENCY_NATIVE = [
    r"நெஞ்சு வலி", r"நெஞ்சுவலி", r"மூச்சு (விட|திண)", r"மயக்க", r"ரத்தம்", r"இரத்தம்", r"விபத்து", r"அவசர",
    r"सीने में दर्द", r"बेहोश", r"सांस नहीं",
]
_EMERGENCY_RE = re.compile(
    "|".join([rf"\b(?:{p})\b" for p in _EMERGENCY_LATIN] + _EMERGENCY_NATIVE), re.IGNORECASE)

EMERGENCY_REPLY = {
    "en-IN": "This sounds like it could be an emergency. Please call 108 for an ambulance right away, or come "
             "straight to our emergency department. I am alerting our emergency staff now.",
    "ta-IN": "இது அவசர நிலையாக இருக்கலாம். உடனே 108-க்கு அழைத்து ஆம்புலன்ஸ் வரவழையுங்கள், அல்லது நேரடியாக "
             "எங்கள் அவசர சிகிச்சைப் பிரிவுக்கு வாருங்கள். நான் இப்போதே எங்கள் அவசர ஊழியர்களுக்குத் தெரிவிக்கிறேன்.",
    "hi-IN": "यह आपातकाल हो सकता है। कृपया तुरंत 108 पर एम्बुलेंस के लिए कॉल करें या सीधे हमारे इमरजेंसी विभाग में आएं। "
             "मैं अभी हमारे इमरजेंसी स्टाफ को सूचित कर रही हूँ।",
}


def emergency_guard(text: str) -> GuardResult | None:
    if _EMERGENCY_RE.search(text):
        return GuardResult(reply=EMERGENCY_REPLY, escalate_reason="emergency", priority="critical")
    return None


INSTRUCTIONS = """You handle hospital customer care: doctor availability, departments, appointment booking,
cancellation, rescheduling, visiting hours and directions.
Healthcare rules (strict):
- Never diagnose, never suggest or prescribe medicines or dosages, never interpret reports. If asked, say a doctor
  needs to advise on that and offer to book a consultation.
- Never invent doctors, timings, slots or fees: always use the tools.
- If anything sounds like an emergency, tell the caller to call 108 or come to Emergency immediately and transfer
  to staff with reason "emergency".
- Patient details are private: only discuss appointments after the caller gives the booking mobile number.
- To book: find the doctor, check slots for the date, offer at most 3 times, collect patient name and mobile, read
  back doctor/date/time/name, then call book_appointment with confirmed=true only after a clear yes."""

MODULE = IndustryModule(
    key="healthcare",
    label="Hospitals & Healthcare",
    default_instructions=INSTRUCTIONS,
    default_tools=COMMON_TOOLS + hc_tools.TOOLS,
    guards=[emergency_guard],
)
