from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    app_name: str = "Voice Care Platform"
    environment: str = "development"
    log_level: str = "INFO"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    # Database / cache
    database_url: str = "sqlite+aiosqlite:///./voicecare.db"
    redis_url: str | None = None

    # Security
    jwt_secret: str = "dev-only-change-me"
    jwt_expire_minutes: int = 720
    encryption_key: str | None = None  # Fernet key; required outside development
    rate_limit_per_minute: int = 120

    # Sarvam AI
    sarvam_api_key: str | None = None
    sarvam_base_url: str = "https://api.sarvam.ai"
    sarvam_ws_base_url: str = "wss://api.sarvam.ai"
    sarvam_stt_model: str = "saaras:v4"
    sarvam_tts_model: str = "bulbul:v4-flash"
    sarvam_llm_model: str = "sarvam-105b-conversations"
    sarvam_llm_reasoning_effort: str = "low"

    # Engine limits
    llm_timeout_seconds: float = 20.0
    tool_timeout_seconds: float = 8.0
    max_tool_rounds: int = 4
    history_max_messages: int = 20

    # Seed demo data (two demo businesses) on first start in development
    seed_demo_data: bool = True

    @property
    def is_production(self) -> bool:
        return self.environment != "development"

    def production_problems(self) -> tuple[list[str], list[str]]:
        """(errors, warnings) for a non-development deploy. Errors stop the server from starting."""
        errors, warnings = [], []
        if self.jwt_secret == "dev-only-change-me" or len(self.jwt_secret) < 32:
            errors.append("JWT_SECRET must be a random value of at least 32 characters")
        try:
            from cryptography.fernet import Fernet

            Fernet((self.encryption_key or "").encode())
        except Exception:
            errors.append("ENCRYPTION_KEY must be a valid Fernet key")
        if self.is_sqlite:
            errors.append("DATABASE_URL must point to PostgreSQL, not SQLite")
        if any(o == "*" or "localhost" in o or "127.0.0.1" in o for o in self.cors_origins):
            warnings.append("CORS_ORIGINS includes '*' or localhost; set it to your dashboard's https origin")
        if any(o.startswith("http://") for o in self.cors_origins if "localhost" not in o):
            warnings.append("CORS_ORIGINS uses http://; browsers need https for the microphone")
        if not self.sarvam_configured:
            warnings.append("SARVAM_API_KEY is not set; voice and AI replies are disabled")
        if not self.redis_url:
            warnings.append("REDIS_URL is not set; live call state is in-process (single replica only)")
        return errors, warnings

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def sarvam_configured(self) -> bool:
        return bool(self.sarvam_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
