from app.industries.base import IndustryModule
from app.tools.common import COMMON_TOOLS

MODULE = IndustryModule(
    key="custom",
    label="Custom Business",
    default_instructions="Help callers using the business's knowledge base and information. Capture a lead or "
                         "transfer to a human for anything you cannot resolve with the tools.",
    default_tools=list(COMMON_TOOLS),
)
