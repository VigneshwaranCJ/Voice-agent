"""Bulbul v4 (`bulbul:v4-flash`) persona defaults. Persona ids are `<name>_<lang>_<style>`.

Sources: docs.sarvam.ai TTS voices + best-practices pages (2026-11). Sarvam lists no Tamil "customer" persona;
`gokul_ta_narration` is a calm default — audition and override per business in the voice profile.
"""

DEFAULT_SPEAKERS = {
    "en-IN": "aparna_en_companion",   # Sarvam's #1 pick for empathetic customer care (en)
    "ta-IN": "gokul_ta_narration",
    "hi-IN": "aparna_hi_customer",
}

SUGGESTED = {
    "en-IN": ["aparna_en_companion", "sanchita_en_companion", "simran_en_customer", "shalini_en_customer",
              "ishita_en_customer", "neha_en_customer", "sanchita_en_insurance", "dev_en_conversational"],
    "ta-IN": ["gokul_ta_narration", "vijay_ta_narration", "aravind_ta_ads"],
    "hi-IN": ["aparna_hi_customer", "aarti_hi_customer", "simran_enhi_customer", "ishita_enhi_customer"],
}


def speaker_for(speakers: dict | None, language: str) -> str:
    return (speakers or {}).get(language) or DEFAULT_SPEAKERS.get(language) or DEFAULT_SPEAKERS["en-IN"]
