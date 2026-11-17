"""Industry module registry. Importing this module registers all industry tools and models."""

from app.industries.base import IndustryModule
from app.industries.custom.module import MODULE as CUSTOM
from app.industries.healthcare import models as _hc_models  # noqa: F401
from app.industries.healthcare.module import MODULE as HEALTHCARE
from app.industries.real_estate import models as _re_models  # noqa: F401
from app.industries.real_estate.module import MODULE as REAL_ESTATE

INDUSTRIES: dict[str, IndustryModule] = {m.key: m for m in (REAL_ESTATE, HEALTHCARE, CUSTOM)}

# Planned modules (Phase 4) fall back to the custom module until implemented.
PLANNED = {"hospitality": "Hotels & Hospitality", "education": "Educational Institutions",
           "banking": "Banking & Financial Services", "ecommerce": "E-commerce"}


def get_industry(key: str) -> IndustryModule:
    return INDUSTRIES.get(key, CUSTOM)
