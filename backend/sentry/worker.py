import logging
import multiprocessing as mp
import shutil
import time
import uuid

from pydantic import ValidationError

from .adapters import JobRequest, create_adapter
from .config import Settings
from .contracts import DecisionResult, FinalResult
from .db import Database
from .errors import SentryError
from .isolation import ProcessTree, WorkerLock
from .media import atomic_json, extract_frame
from .services import job_dir, read_result
from .storage import clean_incomplete_uploads

log = logging.getLogger(__name__)


def process_job(settings, db, adapter, job, worker_id):
    directory = job_dir(settings, job)
    started = time.time()
    db.stage(job["id"], worker_id, "observing")
    request = JobRequest(job["id"], directory / f'input{job["extension"]}', directory / "artifacts",
                         job["duration"], job["deadline"])
    raw = adapter.analyze(request)
    db.stage(job["id"], worker_id, "reasoning")
    try:
        # Revalidate even already-constructed models; never trust model_construct or mutated instances.
        decision = DecisionResult.model_validate(raw.model_dump() if isinstance(raw, DecisionResult) else raw)
        if abs(decision.source_duration_sec-job["duration"]) > 1e-6:
            raise ValueError("Source duration mismatch")
        if decision.is_demo != bool(job["is_demo"]) or (job["channel"] == "jury" and decision.is_demo):
            raise ValueError("Provenance mismatch")
    except (ValidationError, ValueError, TypeError):
        raise SentryError("INVALID_RESULT") from None
    db.stage(job["id"], worker_id, "evidence")
    evidence = [[extract_frame(request.input_path, directory / "evidence", timestamp,
                               job["duration"], settings, job["deadline"])
                 for timestamp in violation.evidence_timestamps] for violation in decision.violations]
    db.stage(job["id"], worker_id, "finalizing")
    finalizing = time.time()
    final = FinalResult(decision=decision, evidence=evidence)
    atomic_json(directory / "final_result.json", final.model_dump())
    # Validate stored bytes and every JPEG before the terminal DB transition.
    read_result(settings, {**job, "result_ref": "final_result.json"})
    now = time.time()
    timings = {"upload_preparation_sec": job["uploaded_at"]-job["created_at"],
               "queue_wait_sec": job["started_at"]-job["uploaded_at"],
               "processing_sec": finalizing-started, "finalization_sec": now-finalizing,
               "end_to_end_sec": now-job["created_at"]}
    if not db.finish(job["id"], worker_id, decision.verdict, timings):
        raise SentryError("JOB_TIMEOUT")
    log.info("job=%s stage=done end_to_end_sec=%.3f", job["id"], timings["end_to_end_sec"])


def processing_child(settings, worker_id, connection, adapter_factory=create_adapter):
    # Spawn starts here; parent assigns us to its Job Object before sending the gate token.
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    adapter = None
    try:
        if connection.recv() != "start":
            return
        db = Database(settings)
        if not shutil.which(settings.ffmpeg_path) or not shutil.which(settings.ffprobe_path):
            raise SentryError("MEDIA_UNAVAILABLE", 503)
        adapter = adapter_factory(settings)
        adapter.initialize()
        connection.send(("ready", None))
        while True:
            job = connection.recv()
            if job is None:
                return
            try:
                process_job(settings, db, adapter, job, worker_id)
                connection.send(("done", job["id"]))
            except SentryError as error:
                db.fail(job["id"], error.code, worker_id)
                connection.send(("failed", error.code))
                return  # failed runtimes are reinitialized, never reused
            except Exception:
                db.fail(job["id"], "PIPELINE_FAILED", worker_id)
                connection.send(("failed", "PIPELINE_FAILED"))
                return
    except SentryError as error:
        connection.send(("init_failed", error.code))
    except (EOFError, BrokenPipeError):
        pass
    except Exception:
        try:
            connection.send(("init_failed", "PIPELINE_FAILED"))
        except (EOFError, BrokenPipeError):
            pass
    finally:
        if adapter is not None:
            try:
                adapter.shutdown()
            except Exception:
                log.error("adapter_shutdown error=PIPELINE_FAILED")
        connection.close()


class Worker:
    def __init__(self, settings, adapter_factory=create_adapter):
        self.settings = settings
        self.db = Database(settings)
        self.worker_id = uuid.uuid4().hex
        self.adapter_factory = adapter_factory  # Python injection for tests; no env/config bypass.
        self.child = None
        self.connection = None
        self.tree = None
        self.ready = False
        self.init_error = None
        self.active_job = None
        self.last_cleanup = 0.0

    def stop_child(self):
        self.ready = False
        if self.child is not None:
            # Terminate the entire owned tree and verify descendants AND root exited.
            self.tree.terminate()
            self.child.join(timeout=10)
            if self.child.is_alive():
                raise RuntimeError("Owned child still alive; refusing another GPU job")
            self.child.close()
            self.child = None
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def start_child(self):
        self.tree.wait_empty()
        context = mp.get_context("spawn")
        self.connection, child_connection = context.Pipe()
        self.child = context.Process(target=processing_child,
                                     args=(self.settings, self.worker_id, child_connection, self.adapter_factory))
        self.child.start()
        child_connection.close()
        try:
            self.tree.assign(self.child.pid)
        except BaseException:
            # Before assignment the gate is still closed, so this process has no descendants.
            self.child.terminate()
            self.child.join(timeout=10)
            raise
        self.connection.send("start")
        end = time.monotonic() + self.settings.worker_startup_timeout_sec
        while time.monotonic() < end and self.child.is_alive():
            self.db.heartbeat(self.worker_id, False)
            self.db.expire()
            try:
                if self.connection.poll(self.settings.worker_poll_sec):
                    kind, value = self.connection.recv()
                    self.ready = kind == "ready"
                    self.init_error = None if self.ready else value
                    if not self.ready:
                        self.stop_child()
                    return
            except (EOFError, OSError):
                break
        self.init_error = "WORKER_INTERRUPTED"
        self.stop_child()

    def tick(self):
        self.db.expire()
        if time.monotonic()-self.last_cleanup > 5:
            clean_incomplete_uploads(self.db, self.settings)
            self.last_cleanup = time.monotonic()
        if self.active_job:
            current = self.db.get(self.active_job["id"])
            if current["status"] in {"failed", "cancelled"} or time.time() >= current["deadline"]:
                self.db.fail(current["id"], "JOB_TIMEOUT", self.worker_id)
                self.stop_child()
                self.db.release(current["id"], self.worker_id)
                self.active_job = None
                return
            try:
                message_available = self.connection.poll()
                if message_available:
                    kind, _ = self.connection.recv()
            except (EOFError, OSError):
                message_available, kind = True, "crashed"
            if message_available:
                if kind != "done":
                    self.db.fail(current["id"], "WORKER_INTERRUPTED", self.worker_id)
                    self.stop_child()
                    self.db.release(current["id"], self.worker_id)
                self.active_job = None
            elif not self.child.is_alive():
                self.db.fail(current["id"], "WORKER_INTERRUPTED", self.worker_id)
                self.stop_child()
                self.db.release(current["id"], self.worker_id)
                self.active_job = None
            return
        if not self.ready:
            if self.settings.pipeline_mode == "disabled" or self.init_error is not None:
                return
            self.start_child()
        if self.ready and not self.child.is_alive():
            self.stop_child()
            return
        if self.ready:
            job = self.db.claim(self.worker_id)
            if job:
                self.active_job = job
                try:
                    self.connection.send(job)
                except (EOFError, BrokenPipeError, OSError):
                    self.db.fail(job["id"], "WORKER_INTERRUPTED", self.worker_id)
                    self.stop_child()
                    self.active_job = None

    def run(self, stop_event=None):
        with WorkerLock(self.settings.data_dir):
            self.tree = ProcessTree(self.settings.data_dir)
            try:
                self.tree.wait_empty()
                self.db.recover()
                while stop_event is None or not stop_event.is_set():
                    self.tick()
                    self.db.heartbeat(self.worker_id, self.ready, self.init_error)
                    if stop_event is None:
                        time.sleep(self.settings.worker_poll_sec)
                    else:
                        stop_event.wait(self.settings.worker_poll_sec)
            finally:
                if self.active_job:
                    self.db.fail(self.active_job["id"], "WORKER_INTERRUPTED", self.worker_id)
                try:
                    self.stop_child()
                finally:
                    self.db.heartbeat(self.worker_id, False, "WORKER_INTERRUPTED")
                    self.tree.close()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        Worker(Settings()).run()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    mp.freeze_support()
    main()
