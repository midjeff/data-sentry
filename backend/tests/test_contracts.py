import math

import pytest
from pydantic import ValidationError

from sentry.adapters import RealPipelineAdapter
from sentry.config import Settings
from sentry.contracts import DecisionResult
from sentry.errors import SentryError


def valid():
    return {"schema_version": "1.0", "complete": True, "source_duration_sec": 2.0,
            "verdict": "violation", "violations": [{"type": "test", "timecode_sec": 0.0,
                "description": "controlled test", "evidence_timestamps": [0.0]}],
            "is_demo": False, "provenance": "test-double"}


def test_zero_is_valid():
    assert DecisionResult.model_validate(valid()).violations[0].timecode_sec == 0.0


@pytest.mark.parametrize("timestamp", [-1.0, 2.0, 3.0, math.nan, math.inf, -math.inf])
@pytest.mark.parametrize("field", ["timecode_sec", "evidence_timestamps"])
def test_invalid_timestamps(timestamp, field):
    data = valid()
    data["violations"][0][field] = [timestamp] if field == "evidence_timestamps" else timestamp
    with pytest.raises(ValidationError):
        DecisionResult.model_validate(data)


@pytest.mark.parametrize("change", [{"complete": False}, {"complete": 1}, {"verdict": "no_violation"}, {"violations": []},
                                    {"source_duration_sec": float("inf")}, {"schema_version": "2.0"}])
def test_invalid_decisions(change):
    with pytest.raises(ValidationError):
        DecisionResult.model_validate({**valid(), **change})


@pytest.mark.parametrize("data", [{"status": "done", "events": []}, {"status": "done", "events": [{}]},
                                  {"status": "partial_or_invalid", "events": []}])
def test_observations_are_not_decisions(data):
    with pytest.raises(ValidationError):
        DecisionResult.model_validate(data)


def test_real_boundary_fails_closed(settings):
    adapter = RealPipelineAdapter(settings)
    with pytest.raises(SentryError, match="not configured"):
        adapter.initialize()
    with pytest.raises(SentryError):
        adapter.analyze(None)


def test_safe_defaults_and_configuration(tmp_path):
    assert Settings(_env_file=None).pipeline_mode == "disabled"
    for options in [dict(app_env="production", pipeline_mode="mock", cookie_secure=True),
                    dict(app_env="production", cookie_secure=False), dict(allowed_origins=["*"]),
                    dict(allowed_origins=["http://localhost/path"]), dict(data_dir="relative")]:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **options)
