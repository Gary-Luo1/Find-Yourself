from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    app_env: str = "development"

    # 兼容旧配置：建议改用 llm_mode（server/byok）
    trust_client_llm: bool = False
    # server: 仅服务端 .env 配置密钥（默认更安全）
    # byok: 允许浏览器传入 API Key（建议仅内网或可信场景）
    llm_mode: str = "server"
    # BYOK 模式下可选：限制浏览器可用的 Base URL，逗号分隔；留空表示不限制
    allowed_client_base_urls: str = ""

    # 逗号分隔的 Origin，如 https://resume.example.com；填 * 表示允许任意 Origin（不推荐公网）
    cors_allow_origins: str = "http://127.0.0.1:8000,http://localhost:8000"

    # 公网建议关闭，避免暴露 OpenAPI 结构
    expose_api_docs: bool = False

    # 简历 / JD 上传解析（PDF、docx）单文件大小上限（字节）
    max_upload_bytes: int = Field(default=5 * 1024 * 1024, ge=64_000, le=50 * 1024 * 1024)


settings = Settings()
