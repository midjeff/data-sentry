import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

from PIL import Image

from .contracts import EvidenceFrame
from .errors import SentryError


def run_media(args, settings, deadline):
    remaining = deadline - time.time()
    if remaining <= 0:
        raise SentryError("JOB_TIMEOUT", 408)
    try:
        result = subprocess.run(args, shell=False, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=min(settings.media_timeout_sec, remaining),
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    except FileNotFoundError:
        raise SentryError("MEDIA_UNAVAILABLE", 503) from None
    except subprocess.TimeoutExpired:
        raise SentryError("JOB_TIMEOUT" if time.time() >= deadline else "INVALID_MEDIA", 408) from None
    if result.returncode:
        raise SentryError("INVALID_MEDIA", 422)
    return result


def probe(path, settings, deadline):
    result = run_media([settings.ffprobe_path, "-v", "error", "-protocol_whitelist", "file,pipe",
                        "-format_whitelist", "mov,avi,matroska,webm",
                        "-select_streams", "v:0", "-show_entries",
                        "stream=codec_name,width,height,duration,start_time:format=duration,start_time",
                        "-of", "json", str(path)], settings, deadline)
    try:
        data = json.loads(result.stdout)
        stream = data["streams"][0]
        container = data.get("format", {})
        # Prefer the selected video stream's duration, preserving any offset from the file origin.
        if stream.get("duration") not in (None, "N/A"):
            offset = float(stream.get("start_time", 0)) - float(container.get("start_time", 0))
            duration = float(stream["duration"]) + max(0.0, offset)
        else:
            # Matroska/WebM report a timeline endpoint when they carry a positive start PTS.
            duration = float(container["duration"]) - max(0.0, float(container.get("start_time", 0)))
        if not math.isfinite(duration) or duration <= 0 or stream["width"] <= 0 or stream["height"] <= 0:
            raise ValueError()
        # Container metadata alone does not establish that a codec can actually decode.
        decoded = run_media([settings.ffmpeg_path, "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe",
                   "-format_whitelist", "mov,avi,matroska,webm",
                   "-i", str(path), "-map", "0:v:0", "-frames:v", "1", "-an",
                   "-vf", "scale=192:-2", "-c:v", "mjpeg", "-f", "image2pipe", "-"], settings, deadline)
        try:
            jpeg_info(decoded.stdout)
        except SentryError:
            raise SentryError("INVALID_MEDIA", 422) from None
        return duration
    except (KeyError, IndexError, ValueError, TypeError):
        raise SentryError("INVALID_MEDIA", 422) from None


def jpeg_info(data):
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.format != "JPEG" or min(img.size) < 1:
                raise ValueError()
            img.verify()
        with Image.open(io.BytesIO(data)) as img:
            img.load()
            return img.size
    except Exception:
        raise SentryError("EVIDENCE_FAILED") from None


def extract_frame(path: Path, evidence_dir: Path, requested: float, duration: float, settings, deadline):
    if not math.isfinite(requested) or not 0 <= requested < duration:
        raise SentryError("INVALID_RESULT")
    frame_id = uuid.uuid4().hex
    output = evidence_dir / f"{frame_id}.jpg"
    # Decode in source order; select the first actual frame at/after the requested timestamp.
    # No random thumbnail, guessed FPS, input seek, or silent timestamp substitution.
    result = run_media([settings.ffmpeg_path, "-hide_banner", "-loglevel", "info", "-nostdin",
                        "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,avi,matroska,webm",
                        "-copyts", "-start_at_zero", "-i", str(path),
                        "-map", "0:v:0", "-an", "-vf", f"select=gte(t\\,{requested:.9f}),showinfo",
                        "-frames:v", "1", "-fps_mode", "vfr", "-q:v", "2", "-y", str(output)], settings, deadline)
    match = re.search(rb"\bn:\s*0\s+pts:\s*(-?\d+)", result.stderr)
    time_base = re.search(rb"config in time_base:\s*(\d+)/(\d+)", result.stderr)
    if not match or not time_base or not output.exists():
        raise SentryError("EVIDENCE_FAILED")
    # Use integer PTS and rational time base, not rounded showinfo pts_time text.
    actual = int(match[1]) * int(time_base[1]) / int(time_base[2])
    if not math.isfinite(actual) or not 0 <= actual < duration:
        raise SentryError("EVIDENCE_FAILED")
    width, height = jpeg_info(output.read_bytes())
    return EvidenceFrame(frame_id=frame_id, timestamp_sec=actual, requested_timestamp_sec=requested,
                         selection_offset_sec=actual-requested, width=width, height=height)


def atomic_json(path, value):
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
