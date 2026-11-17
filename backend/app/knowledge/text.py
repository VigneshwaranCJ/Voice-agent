import re
import unicodedata

_STOP = {
    "the", "a", "an", "is", "are", "was", "of", "to", "in", "on", "for", "and", "or", "what", "how", "do",
    "does", "i", "you", "me", "my", "we", "your", "it", "can", "be", "with", "at", "by", "this", "that",
    "please", "tell", "about", "any", "there", "have", "has", "will", "would", "from",
}
# Unicode-aware word pattern: keeps Tamil/Devanagari letters incl. combining marks.
_WORD = re.compile(r"[\w஀-௿ऀ-ॿఀ-౿ಀ-೿ഀ-ൿ]+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    text = unicodedata.normalize("NFC", text.lower())
    out = []
    for w in _WORD.findall(text):
        if w in _STOP or len(w) < 2:
            continue
        # light English stemming
        for suf in ("ing", "es", "s"):
            if w.isascii() and len(w) > 4 and w.endswith(suf):
                w = w[: -len(suf)]
                break
        out.append(w)
    return out
