# Testing

```bash
cd backend && uv run pytest -q
```

Tests run on a temporary SQLite DB with the demo seed, and a scripted LLM test double (`tests/conftest.py`)
so tool-calling flows are deterministic. Sarvam STT/TTS sockets are replaced by fakes in `test_voice_session.py`.

| # | Scenario | Test |
|---|---|---|
| 1 | Real estate property enquiry | `test_engine_real_estate.py::test_property_enquiry_uses_database`, `test_budget_filter` |
| 2 | Site visit booking (confirm gate, exec assignment, lead) | `test_site_visit_requires_confirmation_then_books`, `test_site_visit_rejects_past_and_offhours` |
| 3 | Doctor availability | `test_engine_healthcare.py::test_doctor_availability` |
| 4 | Appointment booking / double-booking / cancel auth | `test_book_and_double_booking_and_cancel` |
| 5 | Emergency escalation (EN + Tamil) | `test_emergency_escalates_without_llm`, `test_tamil_emergency`, `test_voice_handoff_event` |
| 6–7 | Hotel enquiry / reservation | ⬜ hospitality module not built yet |
| 8–10 | Tamil / English / Tanglish | `test_language_switch_and_prompt`, `test_tanglish_handoff`, `test_typed_tamil_detected_by_script`, `test_voice_turn_bargein_and_language` |
| 11 | Customer context retrieval | `test_customer_context_across_calls` |
| 12 | Business DB failure | `test_business_db_failure_is_handled`, `test_llm_failure_fallback_then_escalation` |
| 13 | Human handoff | `test_human_handoff_request` |
| 14 | Tenant isolation | `test_tenant_isolation.py` (API, header spoofing, tools, knowledge, widget tokens) |
| 15 | Caller interruption | `test_voice_turn_bargein_and_language` |

## Manual voice test (needs `SARVAM_API_KEY`)
1. Start backend + frontend, sign in, open **Voice Console**.
2. Sunrise Realty: "I'm looking for a 2BHK apartment in Coimbatore under 70 lakh" → expect Saravanampatti / Peelamedu options; book a site visit and check **Business Data**.
3. Switch to Tamil mid-call: "எனக்கு Peelamedu-ல 2BHK வேணும்" → reply in Tamil with the Tamil voice.
4. Interrupt while the agent is speaking → playback stops immediately.
5. CareWell: "I want a cardiologist appointment tomorrow" → real slots; confirm; then "my father has chest pain" → 108 guidance + critical escalation.
6. Check **Calls & Transcripts** for transcript, summary, tool executions and call events.
