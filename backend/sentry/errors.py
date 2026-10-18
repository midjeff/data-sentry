MESSAGES = {
    "ML_NOT_CONFIGURED": "The real decision pipeline is not configured.",
    "PIPELINE_DISABLED": "Processing is disabled.",
    "WORKER_UNAVAILABLE": "A compatible processing worker is unavailable.",
    "QUEUE_FULL": "The processing queue is full.",
    "INVALID_UPLOAD": "Send exactly one non-empty video field named file.",
    "UPLOAD_TOO_LARGE": "The upload exceeds the configured size limit.",
    "UNSUPPORTED_EXTENSION": "Unsupported video extension.",
    "INVALID_MEDIA": "Video is corrupt, unreadable, or uses an unsupported codec.",
    "MEDIA_UNAVAILABLE": "FFmpeg or ffprobe is unavailable.",
    "INVALID_RESULT": "The pipeline did not produce a valid final decision.",
    "EVIDENCE_FAILED": "Valid evidence frames could not be extracted.",
    "JOB_TIMEOUT": "The total job deadline was exceeded.",
    "WORKER_INTERRUPTED": "Processing was interrupted; submit a new job.",
    "PIPELINE_FAILED": "The processing pipeline failed.",
    "ARTIFACT_UNAVAILABLE": "A required result artifact is unavailable.",
    "UNAUTHORIZED": "Authentication required.",
    "CSRF_REJECTED": "Origin or CSRF token is invalid.",
    "NOT_FOUND": "Job or media not found.",
}


class SentryError(Exception):
    def __init__(self, code: str, status: int = 400):
        self.code = code if code in MESSAGES else "PIPELINE_FAILED"
        self.status = status
        super().__init__(MESSAGES[self.code])


def safe_error(code: str) -> dict:
    code = code if code in MESSAGES else "PIPELINE_FAILED"
    return {"code": code, "message": MESSAGES[code]}
