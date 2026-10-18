import base64
import asyncio
import io
import time

from fastapi.testclient import TestClient
from PIL import Image
import pytest
import httpx

from sentry.adapters import MockPipelineAdapter
from sentry.api import create_app
from sentry.worker import process_job
from .conftest import browser_session, submit
from .doubles import ReadyDecisionAdapter

JURY = {"X-API-Key": "test-only-key"}


@pytest.mark.parametrize("key", [None, "wrong"])
def test_jury_auth(client, key):
    headers = {} if key is None else {"X-API-Key": key}
    assert client.post("/api/v1/analyze", headers=headers).status_code == 401
    assert client.get("/api/v1/jobs/missing", headers=headers).status_code == 401


def test_missing_server_key(settings):
    settings.jury_api_key = type(settings.jury_api_key)("")
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/jobs/missing", headers=JURY).status_code == 401


def test_mock_jury_isolation_and_readiness(client, app, settings, video):
    assert client.post("/api/v1/analyze", headers=JURY).status_code == 503
    response = submit(client, video)
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    assert client.get(f"/api/v1/jobs/{job_id}", headers=JURY).status_code == 404
    settings.pipeline_mode = "real"
    app.state.db.heartbeat("test-real", True)
    assert client.get(f"/api/v1/jobs/{job_id}", headers=JURY).status_code == 404
    assert client.get("/health/live").json() == {"api_running": True}


def test_disabled_and_stale_readiness(settings):
    settings.pipeline_mode = "disabled"
    with TestClient(create_app(settings)) as client:
        headers = browser_session(client)
        assert client.get("/health/ready").status_code == 503
        assert client.post("/api/ui/analyze", headers=headers).status_code == 503


@pytest.mark.parametrize("scenario", ["no_violation", "violations"])
def test_jury_exact_success_contract(settings, video, scenario):
    settings.pipeline_mode = "real"
    settings.mock_scenario = scenario
    app = create_app(settings)
    db = app.state.db
    db.heartbeat("controlled-ready-adapter", True)
    with TestClient(app) as client:
        response = submit(client, video, JURY, jury=True)
        assert response.status_code == 202, response.text
        assert set(response.json()) == {"job_id"}
        job_id = response.json()["job_id"]
        assert client.get(f"/api/v1/jobs/{job_id}", headers=JURY).json() == {"job_id": job_id, "status": "processing"}
        job = db.claim("test-worker")
        adapter = ReadyDecisionAdapter(settings)
        adapter.initialize()
        process_job(settings, db, adapter, job, "test-worker")
        result = client.get(f"/api/v1/jobs/{job_id}", headers=JURY).json()
        assert set(result) == {"job_id", "status", "verdict", "violations"}
        assert result["status"] == "done"
        assert result["verdict"] == ("violation" if scenario == "violations" else "no_violation")
        assert len(result["violations"]) == (2 if scenario == "violations" else 0)
        for violation in result["violations"]:
            assert set(violation) == {"type", "timecode_sec", "description", "evidence_frames"}
            for frame in violation["evidence_frames"]:
                assert set(frame) == {"timestamp_sec", "image_base64"}
                with Image.open(io.BytesIO(base64.b64decode(frame["image_base64"], validate=True))) as image:
                    assert image.format == "JPEG" and image.size == (96, 64)
        if scenario == "violations":
            assert result["violations"][0]["evidence_frames"][0]["timestamp_sec"] == 0.0
        browser_session(client)
        assert client.get("/api/ui/jobs").json()["total"] == 0
        assert client.get(f"/api/ui/jobs/{job_id}").status_code == 404


def test_failed_jury_safe_serialization(settings, video):
    settings.pipeline_mode = "real"
    app = create_app(settings)
    app.state.db.heartbeat("ready", True)
    with TestClient(app) as client:
        job_id = submit(client, video, JURY, jury=True).json()["job_id"]
        app.state.db.fail(job_id, "PIPELINE_FAILED")
        result = client.get(f"/api/v1/jobs/{job_id}", headers=JURY).json()
        assert set(result) == {"job_id", "status", "error"}
        assert result["error"] == {"code": "PIPELINE_FAILED", "message": "The processing pipeline failed."}


@pytest.mark.parametrize("case,expected", [("empty", 422), ("oversized", 413), ("multiple", 422),
                                          ("unsupported", 415), ("corrupt", 422), ("wrong_field", 422),
                                          ("extra_field", 422), ("absent", 422)])
def test_invalid_uploads(client, settings, case, expected):
    settings.upload_limit_bytes = 100
    headers = browser_session(client)
    files = [("file", ("test.mov", b"bad media", "application/octet-stream"))]
    data = None
    if case == "empty": files = [("file", ("test.mov", b""))]
    if case == "oversized": files = [("file", ("test.mov", b"x" * 101))]
    if case == "multiple": files *= 2
    if case == "unsupported": files = [("file", ("test.exe", b"x"))]
    if case == "wrong_field": files = [("other", ("test.mov", b"x"))]
    if case == "extra_field": data = {"scenario": "no_violation"}
    if case == "absent": files = []
    response = client.post("/api/ui/analyze", headers=headers, files=files, data=data)
    assert response.status_code == expected, response.text
    assert list((settings.data_dir / "jobs").iterdir()) == []
    assert client.get("/api/ui/jobs").json()["total"] == 0


def test_chunked_size_enforced_without_content_length(client, settings):
    settings.upload_limit_bytes = 16
    headers = {**browser_session(client), "Content-Type": "multipart/form-data; boundary=abc"}
    body = b'--abc\r\nContent-Disposition: form-data; name="file"; filename="x.mov"\r\n\r\n' + b"x" * 17 + b"\r\n--abc--\r\n"
    response = client.post("/api/ui/analyze", headers=headers, content=iter([body[:80], body[80:]]))
    assert response.status_code == 413


def test_browser_isolation_media_range_and_restart(client, app, settings, video):
    settings.mock_scenario = "violations"
    headers = browser_session(client)
    response = submit(client, video, headers, filename="..\\..\\sample.MOV")
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    job = app.state.db.claim("test-worker")
    process_job(settings, app.state.db, MockPipelineAdapter(settings), job, "test-worker")
    detail = client.get(f"/api/ui/jobs/{job_id}").json()
    assert detail["is_demo"] is True
    frame_id = detail["result"]["evidence"][0][0]["frame_id"]
    paths = [f"/api/ui/jobs/{job_id}", f"/api/ui/jobs/{job_id}/video", f"/api/ui/jobs/{job_id}/evidence/{frame_id}"]
    for path in paths:
        assert client.get(path).status_code == 200
    ranged = client.get(paths[1], headers={"Range": "bytes=0-15"})
    assert ranged.status_code == 206 and len(ranged.content) == 16
    history = client.get("/api/ui/jobs?limit=1&offset=0").json()
    assert history["total"] == 1 and "result" not in history["items"][0]
    assert "base64" not in str(history)
    assert client.get("/api/ui/jobs?offset=1").json()["items"] == []
    with TestClient(app) as other:
        browser_session(other)
        assert other.get("/api/ui/jobs").json()["total"] == 0
        for path in paths:
            assert other.get(path).status_code == 404
    with TestClient(create_app(settings)) as restarted:
        restarted.cookies.update(client.cookies)
        assert restarted.get(paths[0]).json()["status"] == "done"
        assert restarted.get("/api/ui/jobs").json()["total"] == 1
    assert (settings.data_dir / "jobs" / job_id / "input.mov").read_bytes() == video.read_bytes()


def test_csrf_and_session_hashing(client, app):
    assert client.post("/api/ui/session").status_code == 403
    assert client.post("/api/ui/session", headers={"Origin": "https://evil.example"}).status_code == 403
    headers = browser_session(client)
    assert client.post("/api/ui/analyze").status_code == 403
    assert client.post("/api/ui/analyze", headers={**headers, "X-CSRF-Token": "wrong"}).status_code == 403
    assert client.post("/api/ui/analyze", headers={**headers, "Origin": "https://evil.example"}).status_code == 403
    token = client.cookies.get("sentry_session")
    with app.state.db.connect() as db:
        row = dict(db.execute("SELECT * FROM sessions").fetchone())
    assert token not in str(row) and headers["X-CSRF-Token"] not in str(row)
    response = client.post("/api/ui/session", headers={"Origin": "http://localhost:5173"})
    assert "HttpOnly" in response.headers["set-cookie"] and "SameSite=lax" in response.headers["set-cookie"]
    assert client.cookies.get("sentry_session") == token
    assert client.post("/api/ui/analyze", headers=headers).status_code == 403


def test_queue_capacity(client, settings, video):
    settings.queue_capacity = 1
    headers = browser_session(client)
    assert submit(client, video, headers).status_code == 202
    assert submit(client, video, headers).status_code == 503


def test_jury_unconfigured_real_mode(settings):
    settings.pipeline_mode = "real"
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/v1/analyze", headers=JURY)
        assert response.status_code == 503 and response.json()["error"]["code"] == "ML_NOT_CONFIGURED"


def test_upload_deadline_closes_partial_spool(client, app, settings, monkeypatch):
    import starlette.formparsers
    original = starlette.formparsers.SpooledTemporaryFile
    spools = []
    def track_spool(*args, **kwargs):
        spool = original(*args, **kwargs)
        spools.append(spool)
        return spool
    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", track_spool)
    settings.job_timeout_sec = 0.05
    headers = {**browser_session(client), "Content-Type": "multipart/form-data; boundary=abc"}
    async def slow_body():
        yield b'--abc\r\nContent-Disposition: form-data; name="file"; filename="x.mov"\r\n\r\n123'
        await asyncio.sleep(0.2)
        yield b"\r\n--abc--\r\n"
    async def send():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver",
                                     cookies=client.cookies) as async_client:
            return await async_client.post("/api/ui/analyze", headers=headers, content=slow_body())
    response = asyncio.run(send())
    assert response.status_code == 408
    assert response.json()["error"]["code"] == "JOB_TIMEOUT"
    assert spools and all(spool.closed for spool in spools)


def test_corrupt_final_evidence_cannot_serialize_success(settings, video):
    settings.pipeline_mode = "real"
    settings.mock_scenario = "violations"
    app = create_app(settings)
    db = app.state.db
    db.heartbeat("test", True)
    with TestClient(app) as client:
        job_id = submit(client, video, JURY, jury=True).json()["job_id"]
        process_job(settings, db, ReadyDecisionAdapter(settings), db.claim("test"), "test")
        next((settings.data_dir / "jobs" / job_id / "evidence").glob("*.jpg")).write_bytes(b"corrupt")
        result = client.get(f"/api/v1/jobs/{job_id}", headers=JURY).json()
        assert result["status"] == "failed"
        assert result["error"]["code"] == "ARTIFACT_UNAVAILABLE"
        assert "verdict" not in result


def test_oversized_multipart_headers_are_bounded(client):
    headers = {**browser_session(client), "Content-Type": "multipart/form-data; boundary=abc"}
    body = b'--abc\r\nContent-Disposition: form-data; name="file"; filename="' + b"x"*17000 + b'.mov"\r\n\r\n1\r\n--abc--\r\n'
    assert client.post("/api/ui/analyze", headers=headers, content=body).status_code == 422
