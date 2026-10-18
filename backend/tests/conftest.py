import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from sentry.api import create_app
from sentry.config import Settings


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path / "data", pipeline_mode="mock",
                    jury_api_key="test-only-key", job_timeout_sec=30, worker_poll_sec=0.05,
                    worker_startup_timeout_sec=10)


@pytest.fixture
def app(settings):
    app = create_app(settings)
    app.state.db.heartbeat("test-ready", True)
    return app


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="session")
def video(tmp_path_factory):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("FFmpeg/ffprobe missing: synthetic media integration unavailable")
    path = tmp_path_factory.mktemp("synthetic") / "sample.mov"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=96x64:rate=10",
                    "-t", "1.2", "-c:v", "mpeg4", "-y", str(path)], check=True, timeout=15,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return path


def browser_session(client):
    response = client.post("/api/ui/session", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 200
    return {"Origin": "http://localhost:5173", "X-CSRF-Token": response.json()["csrf_token"]}


def submit(client, video, headers=None, jury=False, filename="sample.MOV"):
    headers = headers or browser_session(client)
    with video.open("rb") as stream:
        return client.post("/api/v1/analyze" if jury else "/api/ui/analyze", headers=headers,
                           files={"file": (filename, stream, "application/octet-stream")})
