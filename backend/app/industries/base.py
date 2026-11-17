from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass
class GuardResult:
    """A deterministic pre-LLM decision (e.g. medical emergency)."""

    reply: dict[str, str]  # language -> spoken reply
    escalate_reason: str | None = None
    priority: str = "normal"
    stop_llm: bool = True


@dataclass
class IndustryModule:
    key: str
    label: str
    default_instructions: str
    default_tools: list[str]
    guards: list[Callable[[str], GuardResult | None]] = field(default_factory=list)
