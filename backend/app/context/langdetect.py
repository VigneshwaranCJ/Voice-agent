"""Script-based language hint for typed text (voice turns get language from Sarvam STT)."""

_RANGES = [
    ("ta-IN", 0x0B80, 0x0BFF), ("hi-IN", 0x0900, 0x097F), ("te-IN", 0x0C00, 0x0C7F), ("kn-IN", 0x0C80, 0x0CFF),
    ("ml-IN", 0x0D00, 0x0D7F), ("bn-IN", 0x0980, 0x09FF), ("gu-IN", 0x0A80, 0x0AFF), ("pa-IN", 0x0A00, 0x0A7F),
    ("od-IN", 0x0B00, 0x0B7F),
]


def detect_script_language(text: str) -> str | None:
    counts: dict[str, int] = {}
    latin = 0
    for ch in text:
        cp = ord(ch)
        if ch.isascii() and ch.isalpha():
            latin += 1
            continue
        for code, lo, hi in _RANGES:
            if lo <= cp <= hi:
                counts[code] = counts.get(code, 0) + 1
                break
    if counts:
        return max(counts, key=counts.get)
    return "en-IN" if latin >= 3 else None
