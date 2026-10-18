from pathlib import Path
import ipaddress
import json
import os
import re
import tempfile
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def vercel_origins(environment):
    """Trust only this deployment's platform URLs, never request headers/suffixes."""
    variables = ['VERCEL_PROJECT_PRODUCTION_URL']
    if environment == 'preview':
        variables += ['VERCEL_URL', 'VERCEL_BRANCH_URL']
    origins = []
    for variable in variables:
        host = os.environ.get(variable)
        if not host:
            continue
        # Platform values are DNS names without scheme, port, path or wildcards.
        if (not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+'
                             r'[a-z]{2,63}', host) or host.endswith(('.localhost', '.local'))):
            raise ValueError(f'{variable} must be an exact public DNS hostname')
        origin = 'https://' + host
        if origin not in origins:
            origins.append(origin)
    configured = os.environ.get('ALLOWED_ORIGINS')
    if configured is not None:
        selected = json.loads(configured)
        if (not isinstance(selected, list) or
                any(not isinstance(origin, str) or origin not in origins for origin in selected)):
            raise ValueError('Hosted ALLOWED_ORIGINS may only restrict the trusted Vercel origins')
        return list(dict.fromkeys(selected))
    return origins  # Missing platform URLs fail closed, with no localhost fallback.


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
    storage_backend: Literal["local", "vercel"] = "local"
    database_url: SecretStr = SecretStr("")
    internal_service_token: SecretStr = SecretStr("")
    storage_url: str = ""

    @classmethod
    def for_vercel(cls):
        # Vercel entrypoints always use Postgres, including vercel dev.
        # Do not read the Windows/local .env when constructing a deployed app.
        environment = os.environ.get('VERCEL_ENV')
        origins = {} if environment == 'development' else {'allowed_origins': vercel_origins(environment)}
        return cls(_env_file=None, storage_backend="vercel",
                   data_dir=Path(tempfile.gettempdir()) / "data-sentry",
                   app_env="production" if environment != "development" else "development",
                   cookie_secure=environment != "development", **origins)

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
            if self.app_env == 'production':
                host = parsed.hostname or ''
                try:
                    address = ipaddress.ip_address(host)
                    local = address.is_loopback or address.is_unspecified
                except ValueError:
                    local = host.rstrip('.').lower() == 'localhost' or host.rstrip('.').lower().endswith('.localhost')
                if parsed.scheme != 'https' or local:
                    raise ValueError('Production origins must use HTTPS and cannot be localhost')
        # Reject mapped network drives on Windows as well as UNC paths.
        if __import__("os").name == "nt":
            import ctypes
            if ctypes.windll.kernel32.GetDriveTypeW(self.data_dir.anchor) == 4:
                raise ValueError("DATA_DIR must not be on a network drive")
        return self
