"""Exercise the documented entry points as separate actual Windows processes."""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest


def test_actual_api_and_worker_commands(tmp_path, video):
    if os.name != "nt":
        pytest.skip("Windows worker command")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = {**os.environ, "DATA_DIR": str(tmp_path / "data"), "APP_ENV": "development",
           "PIPELINE_MODE": "mock", "MOCK_SCENARIO": "violations", "COOKIE_SECURE": "false",
           "ALLOWED_ORIGINS": '["http://localhost:5173"]', "JOB_TIMEOUT_SEC": "15"}
    root = Path(__file__).resolve().parents[1]
    processes = []
    try:
        for command in ([sys.executable, "-m", "uvicorn", "sentry.api:create_app", "--factory",
                         "--host", "127.0.0.1", "--port", str(port)],
                        [sys.executable, "-m", "sentry.worker"]):
            processes.append(subprocess.Popen(command, cwd=root, env=env, stdin=subprocess.DEVNULL,
                                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                               creationflags=subprocess.CREATE_NO_WINDOW))
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5) as client:
            end = time.monotonic()+15
            while time.monotonic() < end:
                try:
                    if client.get("/health/ready").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                assert all(process.poll() is None for process in processes)
                time.sleep(0.05)
            else:
                pytest.fail("API/worker did not become ready")
            headers = {"Origin": "http://localhost:5173"}
            csrf = client.post("/api/ui/session", headers=headers).json()["csrf_token"]
            headers["X-CSRF-Token"] = csrf
            with video.open("rb") as stream:
                response = client.post("/api/ui/analyze", headers=headers,
                                       files={"file": ("synthetic.MOV", stream, "application/octet-stream")})
            assert response.status_code == 202, response.text
            job_id = response.json()["job_id"]
            end = time.monotonic()+10
            while time.monotonic() < end:
                result = client.get(f"/api/ui/jobs/{job_id}").json()
                if result["status"] != "processing":
                    break
                time.sleep(0.05)
            assert result["status"] == "done", result
            assert result["is_demo"] is True
            assert len(result["result"]["decision"]["violations"]) == 2
            assert client.get(result["result"]["evidence"][0][0]["url"]).status_code == 200
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()  # Only Popen-owned API/supervisor processes.
            process.wait(timeout=10)
