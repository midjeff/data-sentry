import base64
import json
import logging
from pathlib import Path
import time

from pydantic import ValidationError

from .contracts import FinalResult
from .errors import SentryError, safe_error
from .media import jpeg_info

log = logging.getLogger(__name__)


def readiness(db, settings):
    if settings.storage_backend == 'vercel':
        # Real ML must run on the local GPU computer. Its authenticated connection
        # and data-locality boundary are not implemented or verified yet.
        return {'api_running': True, 'worker_available': False,
                'demo_processing_available': False, 'real_pipeline_ready': False,
                'pipeline_mode': settings.pipeline_mode}
    state = db.worker_state()
    available = bool(state and time.time() - state["heartbeat"] < settings.worker_stale_sec)
    compatible = bool(available and state["mode"] == settings.pipeline_mode)
    ready = bool(compatible and state["ready"])
    return {"api_running": True, "worker_available": available,
            "demo_processing_available": ready and settings.pipeline_mode == "mock",
            "real_pipeline_ready": ready and settings.pipeline_mode == "real",
            "pipeline_mode": settings.pipeline_mode}


def require_processing(db, settings, channel):
    state = readiness(db, settings)
    if channel == "jury" and not state["real_pipeline_ready"]:
        raise SentryError("ML_NOT_CONFIGURED", 503)
    if settings.pipeline_mode == "disabled":
        raise SentryError("PIPELINE_DISABLED", 503)
    if not (state["demo_processing_available"] or state["real_pipeline_ready"]):
        raise SentryError("ML_NOT_CONFIGURED" if settings.pipeline_mode == "real" else "WORKER_UNAVAILABLE", 503)


def owned_job(db, job_id, owner=None, jury=False):
    db.expire()
    job = db.get(job_id)
    if not job or (jury and (job["channel"] != "jury" or job["mode"] != "real" or job["is_demo"])):
        raise SentryError("NOT_FOUND", 404)
    if not jury and (job["channel"] != "ui" or job["owner"] != owner):
        raise SentryError("NOT_FOUND", 404)
    return job


def job_dir(settings, job):
    # ID and extension come exclusively from our durable server-generated record.
    return settings.data_dir / "jobs" / job["id"]


def read_result(settings, job, storage=None):
    try:
        if settings.storage_backend == 'vercel':
            from .cloud_storage import CloudStorage, result_prefix
            storage = storage or CloudStorage(settings)
            prefix = result_prefix(job)
            result = FinalResult.model_validate_json(storage.read(prefix + '/final_result.json'))
            if (result.decision.is_demo != bool(job['is_demo']) or
                    abs(result.decision.source_duration_sec - job['duration']) > 1e-6 or
                    result.decision.verdict != job['verdict']):
                raise ValueError()
            return result
        if job["result_ref"] != "final_result.json":
            raise ValueError()
        result = FinalResult.model_validate_json((job_dir(settings, job) / "final_result.json").read_bytes())
        if result.decision.is_demo != bool(job["is_demo"]):
            raise ValueError()
        if abs(result.decision.source_duration_sec-job["duration"]) > 1e-6:
            raise ValueError()
        if job["verdict"] is not None and result.decision.verdict != job["verdict"]:
            raise ValueError()
        for frames in result.evidence:
            for frame in frames:
                data = (job_dir(settings, job) / "evidence" / f"{frame.frame_id}.jpg").read_bytes()
                if jpeg_info(data) != (frame.width, frame.height):
                    raise ValueError()
        return result
    except (OSError, ValidationError, ValueError, SentryError):
        raise SentryError("ARTIFACT_UNAVAILABLE", 503) from None


def jury_response(settings, job):
    response = {"job_id": job["id"], "status": job["status"]}
    if job["status"] == "failed":
        response["error"] = safe_error(job["error_code"])
    elif job["status"] == "done":
        try:
            result = read_result(settings, job)
            def frame_bytes(frame):
                if settings.storage_backend == 'vercel':
                    from .cloud_storage import CloudStorage, result_prefix
                    return CloudStorage(settings).read(result_prefix(job) + f'/evidence/{frame.frame_id}.jpg')
                return (job_dir(settings, job) / 'evidence' / f'{frame.frame_id}.jpg').read_bytes()
            if result.decision.is_demo:
                raise SentryError("NOT_FOUND", 404)
            response["verdict"] = result.decision.verdict
            response["violations"] = [
                {"type": violation.type, "timecode_sec": violation.timecode_sec,
                 "description": violation.description,
                 "evidence_frames": [
                     {"timestamp_sec": frame.timestamp_sec,
                      "image_base64": base64.b64encode(frame_bytes(frame)).decode("ascii")}
                     for frame in frames]}
                for violation, frames in zip(result.decision.violations, result.evidence)]
        except SentryError as error:
            if error.status == 404:
                raise
            return {"job_id": job["id"], "status": "failed", "error": safe_error(error.code)}
    return response


def ui_response(settings, job, detail=False, storage=None):
    end = job["finished_at"] or time.time()
    timings = json.loads(job["timings"])
    if job["uploaded_at"] is not None:
        timings.setdefault("upload_preparation_sec", max(0, job["uploaded_at"]-job["created_at"]))
        timings.setdefault("queue_wait_sec", max(0, (job["started_at"] or end)-job["uploaded_at"]))
    else:
        timings.setdefault("upload_preparation_sec", max(0, end-job["created_at"]))
    if job["started_at"] is not None:
        timings.setdefault("processing_sec", max(0, end-job["started_at"]))
    timings["end_to_end_sec"] = max(0, end-job["created_at"])
    response = {"job_id": job["id"], "filename": job["filename"], "uploaded_at": job["uploaded_at"],
                "created_at": job["created_at"], "status": job["status"], "stage": job["stage"],
                "is_demo": bool(job["is_demo"]), "verdict": job["verdict"], "timings": timings,
                "batch_id": job.get("batch_id"), "display_name": job.get("display_name") or job["filename"],
                "analysis_request": job.get("analysis_request", ""), "attempt": job.get("attempt", 1)}
    if job["status"] == "failed":
        response["error"] = safe_error(job["error_code"])
    if detail and job["status"] == "done":
        result = read_result(settings, job, storage)
        response["result"] = result.model_dump()
        for frames in response["result"]["evidence"]:
            for frame in frames:
                frame["url"] = f'/api/ui/jobs/{job["id"]}/evidence/{frame["frame_id"]}'
    return response
