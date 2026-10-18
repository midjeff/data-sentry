from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: Literal["development", "production"] = "development"
    pipeline_mode: Literal["disabled", "mock", "real"] = "disabled"
    data_dir: Path = Path(__file__).resolve().parents[1] / "data"
    jury_api_key: SecretStr = SecretStr("")
    allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    cookie_secure: bool = False
    session_ttl_sec: int = Field(default=2592000, ge=60)
    upload_limit_bytes: int = Field(default=256 * 1024 * 1024, ge=1)
    job_timeout_sec: float = Field(default=300, gt=0)
    queue_capacity: int = Field(default=20, ge=1)
    worker_poll_sec: float = Field(default=0.25, gt=0, le=5)
    worker_stale_sec: float = Field(default=10, ge=1)
    worker_startup_timeout_sec: float = Field(default=60, gt=0)
    media_timeout_sec: float = Field(default=30, gt=0)
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    mock_scenario: Literal["no_violation", "violations", "failure"] = "no_violation"

    @model_validator(mode="after")
    def safe_configuration(self):
        if not self.data_dir.is_absolute() or str(self.data_dir).startswith(("\\\\", "//")):
            raise ValueError("DATA_DIR must be an absolute local-disk path")
        self.data_dir = self.data_dir.resolve()
        if self.app_env == "production" and (self.pipeline_mode == "mock" or not self.cookie_secure):
            raise ValueError("Production forbids mock mode and requires Secure cookies")
        for origin in self.allowed_origins:
            parsed = urlsplit(origin)
            if (parsed.scheme not in {"http", "https"} or not parsed.netloc or
                    parsed.path or parsed.query or parsed.fragment or parsed.username or "*" in origin):
                raise ValueError("Origins must be explicit http(s) origins without paths or wildcards")
        # Reject mapped network drives on Windows as well as UNC paths.
        if __import__("os").name == "nt":
            import ctypes
            if ctypes.windll.kernel32.GetDriveTypeW(self.data_dir.anchor) == 4:
                raise ValueError("DATA_DIR must not be on a network drive")
        return self
