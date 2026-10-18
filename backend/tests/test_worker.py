from concurrent.futures import ThreadPoolExecutor
import ctypes
from ctypes import wintypes
import multiprocessing as mp
import os
import shutil
import time
import uuid

import pytest

from sentry.adapters import MockPipelineAdapter
from sentry.db import Database
from sentry.errors import SentryError
from sentry.isolation import WorkerLock
from sentry.media import probe
from sentry.worker import process_job
from .doubles import FileStop, run_worker


def enqueue(settings, video, action="success", budget=20):
    db = Database(settings)
    job_id = uuid.uuid4().hex
    directory = settings.data_dir / "jobs" / job_id
    directory.mkdir()
    (directory / "artifacts").mkdir()
    (directory / "evidence").mkdir()
    shutil.copyfile(video, directory / "input.mov")
    (directory / "artifacts" / "test-action").write_text(action)
    db.reserve(job_id, None, "ui", "synthetic.mov", ".mov", time.time())
    db.enqueue(job_id, 1.2, video.stat().st_size)
    with db.connect(True) as connection:
        connection.execute("UPDATE jobs SET deadline=? WHERE id=?", (time.time()+budget, job_id))
    return job_id


def wait_for(predicate, timeout=10):
    end = time.monotonic()+timeout
    while time.monotonic() < end:
        result = predicate()
        if result:
            return result
        time.sleep(0.025)
    raise AssertionError("Condition did not become true before test deadline")


def terminal(db, job_id):
    row = db.get(job_id)
    return row if row["status"] in {"done", "failed"} else None


@pytest.fixture
def running_worker(settings):
    if os.name != "nt":
        pytest.skip("Windows Job Object supervisor requires Windows")
    context = mp.get_context("spawn")
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    stop = FileStop(settings.data_dir / "test-stop")
    process = context.Process(target=run_worker, args=(settings, stop))
    process.start()
    db = Database(settings)
    try:
        wait_for(lambda: (state := db.worker_state()) and state["ready"])
        yield process, stop, db
    finally:
        stop.set()
        process.join(timeout=10)
        if process.is_alive():
            process.terminate()
            process.join(timeout=10)
        assert not process.is_alive()
        process.close()


def test_atomic_claim_and_durable_queue(settings, video):
    db = Database(settings)
    ids = [enqueue(settings, video) for _ in range(2)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        claims = list(pool.map(lambda i: Database(settings).claim(str(i)), range(8)))
    assert len([job for job in claims if job]) == 1
    assert sum(Database(settings).get(job_id)["worker_id"] is not None for job_id in ids) == 1


def test_expired_queue_never_claims_and_late_finish_rejected(settings, video):
    db = Database(settings)
    job_id = enqueue(settings, video, budget=-0.1)
    assert db.claim("test") is None
    db.expire()
    assert db.get(job_id)["error_code"] == "JOB_TIMEOUT"
    assert db.finish(job_id, "test", "no_violation", {}) is False
    job_id = enqueue(settings, video)
    db.claim("owned")
    assert db.finish(job_id, "not-owner", "no_violation", {}) is False
    db.fail(job_id, "JOB_TIMEOUT", "owned")
    assert db.finish(job_id, "owned", "no_violation", {}) is False


def test_recovery_fails_orphans_preserves_queue(settings, video):
    db = Database(settings)
    orphan = enqueue(settings, video)
    queued = enqueue(settings, video)
    db.claim("dead-worker")
    db.recover()
    assert db.get(orphan)["error_code"] == "WORKER_INTERRUPTED"
    assert db.get(queued)["stage"] == "queued"


def test_observation_output_fails_finalization(settings, video):
    class Observations:
        def analyze(self, request):
            return {"status": "done", "events": []}
    db = Database(settings)
    job_id = enqueue(settings, video)
    job = db.claim("worker")
    with pytest.raises(SentryError) as error:
        process_job(settings, db, Observations(), job, "worker")
    assert error.value.code == "INVALID_RESULT"
    assert db.get(job_id)["status"] != "done"


def test_persistent_child_reused_and_second_worker_excluded(settings, video, running_worker):
    process, stop, db = running_worker
    ids = []
    for _ in range(2):
        job_id = enqueue(settings, video)
        ids.append(job_id)
        assert wait_for(lambda: terminal(db, job_id))["status"] == "done"
    assert len((settings.data_dir / "initializations.txt").read_text().splitlines()) == 1
    with pytest.raises(RuntimeError, match="Another worker"):
        with WorkerLock(settings.data_dir):
            pass
    timings = __import__("json").loads(db.get(ids[-1])["timings"])
    assert all(timings[key] >= 0 for key in timings)


@pytest.mark.parametrize("action,error", [("fail", "PIPELINE_FAILED"), ("crash", "WORKER_INTERRUPTED")])
def test_failed_child_reinitialized(settings, video, running_worker, action, error):
    process, stop, db = running_worker
    failed = enqueue(settings, video, action)
    assert wait_for(lambda: terminal(db, failed))["error_code"] == error
    successor = enqueue(settings, video)
    assert wait_for(lambda: terminal(db, successor))["status"] == "done"
    assert len((settings.data_dir / "initializations.txt").read_text().splitlines()) >= 2


def process_exited(pid):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x00100000, False, pid)
    if not handle:
        return True
    try:
        return kernel.WaitForSingleObject(handle, 0) == 0
    finally:
        kernel.CloseHandle(handle)


def test_hang_kills_owned_descendant_then_continues(settings, video, running_worker):
    process, stop, db = running_worker
    hung = enqueue(settings, video, "hang", budget=1.5)
    pid_path = settings.data_dir / "jobs" / hung / "artifacts" / "descendant.pid"
    wait_for(pid_path.exists)
    descendant = int(pid_path.read_text())
    assert wait_for(lambda: terminal(db, hung))["error_code"] == "JOB_TIMEOUT"
    wait_for(lambda: process_exited(descendant))
    successor = enqueue(settings, video)
    assert wait_for(lambda: terminal(db, successor))["status"] == "done"
    assert db.get(hung)["status"] == "failed"


def test_supervisor_crash_kills_tree_and_restart_recovers(settings, video):
    if os.name != "nt":
        pytest.skip("Windows Job Object supervisor requires Windows")
    context = mp.get_context("spawn")
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    stop = FileStop(settings.data_dir / "test-stop")
    supervisor = context.Process(target=run_worker, args=(settings, stop))
    db = Database(settings)
    hung = enqueue(settings, video, "hang", budget=25)
    successor = enqueue(settings, video)
    supervisor.start()
    try:
        pid_path = settings.data_dir / "jobs" / hung / "artifacts" / "descendant.pid"
        wait_for(pid_path.exists)
        pid = int(pid_path.read_text())
        supervisor.terminate()
        supervisor.join(timeout=5)
        wait_for(lambda: process_exited(pid))
        replacement = context.Process(target=run_worker, args=(settings, stop))
        replacement.start()
        try:
            assert wait_for(lambda: terminal(db, hung))["error_code"] == "WORKER_INTERRUPTED"
            assert wait_for(lambda: terminal(db, successor))["status"] == "done"
        finally:
            stop.set()
            replacement.join(timeout=10)
            if replacement.is_alive():
                replacement.terminate()
                replacement.join(timeout=5)
            replacement.close()
    finally:
        if supervisor.is_alive():
            supervisor.terminate()
            supervisor.join(timeout=5)
        supervisor.close()
