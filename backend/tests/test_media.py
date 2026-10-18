import shutil
import subprocess
import time

import pytest

from sentry.errors import SentryError
from sentry.media import extract_frame, jpeg_info, probe

pytestmark = pytest.mark.media


@pytest.mark.parametrize("extension,codec", [("mov", "mpeg4"), ("mp4", "mpeg4"), ("avi", "mpeg4"),
                                            ("mkv", "mpeg4"), ("webm", "libvpx-vp9")])
def test_supported_containers(settings, tmp_path, video, extension, codec):
    path = tmp_path / f"synthetic.{extension}"
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-c:v", codec, "-y", str(path)],
                   check=True, timeout=15, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert probe(path, settings, time.time()+10) > 0


def test_actual_frame_and_recorded_offset(settings, video, tmp_path):
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    frame = extract_frame(video, evidence, 0.05, 1.2, settings, time.time()+10)
    assert frame.timestamp_sec == pytest.approx(0.1)
    assert frame.selection_offset_sec == pytest.approx(0.05)
    assert jpeg_info((evidence / f"{frame.frame_id}.jpg").read_bytes()) == (96, 64)


@pytest.mark.parametrize("extension", ["mov", "mkv"])
def test_nonzero_source_origin(settings, video, tmp_path, extension):
    path = tmp_path / f"offset.{extension}"
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-c", "copy", "-output_ts_offset", "5",
                    "-y", str(path)], check=True, timeout=15, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    duration = probe(path, settings, time.time()+10)
    assert duration == pytest.approx(1.2)
    frame = extract_frame(path, tmp_path, 0.0, duration, settings, time.time()+10)
    assert frame.timestamp_sec == 0.0


def test_bad_jpeg_and_unreachable_frame(settings, video, tmp_path):
    with pytest.raises(SentryError):
        jpeg_info(b"not a jpeg")
    with pytest.raises(SentryError):
        extract_frame(video, tmp_path, 1.19, 1.2, settings, time.time()+10)


def test_playlist_disguised_as_video_is_rejected(settings, tmp_path, video):
    path = tmp_path / "fake.mp4"
    path.write_text(f"ffconcat version 1.0\nfile '{video.as_posix()}'\n")
    with pytest.raises(SentryError):
        probe(path, settings, time.time()+10)
