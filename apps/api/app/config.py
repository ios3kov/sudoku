from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(alias="DATABASE_URL")
    redis_url: str = Field(alias="REDIS_URL")
    public_origin: str = Field(alias="PUBLIC_ORIGIN")
    session_cookie_name: str = Field(default="sudoku_session", alias="SESSION_COOKIE_NAME")
    session_ttl_days: int = Field(default=30, ge=1, le=180, alias="SESSION_TTL_DAYS")
    secure_cookies: bool = Field(default=True, alias="SECURE_COOKIES")
    require_e2ee_new_conversations: bool = Field(
        default=False,
        alias="REQUIRE_E2EE_NEW_CONVERSATIONS",
    )
    s3_bucket: str = Field(alias="S3_BUCKET")
    s3_region: str = Field(default="auto", alias="S3_REGION")
    s3_endpoint_url: str | None = Field(default=None, alias="S3_ENDPOINT_URL")
    s3_public_endpoint_url: str | None = Field(default=None, alias="S3_PUBLIC_ENDPOINT_URL")
    s3_access_key_id: str | None = Field(default=None, alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str | None = Field(default=None, alias="S3_SECRET_ACCESS_KEY")
    vapid_public_key: str | None = Field(default=None, alias="VAPID_PUBLIC_KEY")
    vapid_private_key: str | None = Field(default=None, alias="VAPID_PRIVATE_KEY")
    vapid_subject: str | None = Field(default=None, alias="VAPID_SUBJECT")
    web_push_allowed_hosts: str = Field(
        default="push.apple.com,fcm.googleapis.com,push.services.mozilla.com",
        alias="WEB_PUSH_ALLOWED_HOSTS",
    )
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    otel_exporter_otlp_endpoint: str | None = Field(default=None, alias="OTEL_EXPORTER_OTLP_ENDPOINT")
    otel_service_name: str = Field(default="sudoku-api", alias="OTEL_SERVICE_NAME")


@lru_cache
def get_settings() -> Settings:
    return Settings()
