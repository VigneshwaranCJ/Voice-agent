import re

from app.industries.base import GuardResult

_HUMAN = re.compile(
    r"\b(human|real person|live agent|talk to (a |an |the )?(person|agent|someone|executive|manager|staff)|"
    r"customer care executive|representative|operator)\b"
    r"|மனிதர்|ஆள் கிட்ட|staff kitta|executive kitta|aal kitta pesa|insaan se|kisi aadmi se",
    re.IGNORECASE,
)

HUMAN_REPLY = {
    "en-IN": "Of course. I'm connecting you to one of our executives now, and I've shared the details so you "
             "won't have to repeat yourself.",
    "ta-IN": "நிச்சயமாக. உங்களை இப்போதே எங்கள் executive-உடன் இணைக்கிறேன். நீங்கள் மீண்டும் சொல்ல வேண்டாம், "
             "விவரங்களை அவர்களிடம் பகிர்ந்துவிட்டேன்.",
    "hi-IN": "ज़रूर। मैं आपको अभी हमारे एक executive से जोड़ रही हूँ, और मैंने आपकी जानकारी उनके साथ साझा कर दी है।",
}

FALLBACK_REPLY = {
    "en-IN": "I'm sorry, I'm having a little trouble right now. Could you please say that once more?",
    "ta-IN": "மன்னிக்கவும், இப்போது சிறிய சிக்கல் உள்ளது. தயவுசெய்து மீண்டும் ஒருமுறை சொல்ல முடியுமா?",
    "hi-IN": "माफ़ कीजिए, अभी थोड़ी दिक्कत आ रही है। क्या आप एक बार फिर से बता सकते हैं?",
}

UNRESOLVED_REPLY = {
    "en-IN": "I'm sorry for the trouble. Let me connect you to one of our executives who can help you directly.",
    "ta-IN": "சிரமத்திற்கு மன்னிக்கவும். உங்களுக்கு நேரடியாக உதவ எங்கள் executive-உடன் இணைக்கிறேன்.",
    "hi-IN": "असुविधा के लिए माफ़ी चाहती हूँ। मैं आपको हमारे executive से जोड़ रही हूँ जो सीधे मदद करेंगे।",
}


def human_request_guard(text: str) -> GuardResult | None:
    if _HUMAN.search(text):
        return GuardResult(reply=HUMAN_REPLY, escalate_reason="customer_request")
    return None


def pick(replies: dict[str, str], lang: str) -> str:
    return replies.get(lang) or replies["en-IN"]
