"""NEW integration interfaces, not wrappers around alleged existing ML functions."""
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .contracts import DecisionResult, DecisionViolation
from .errors import SentryError


@dataclass(frozen=True)
class JobRequest:
    job_id: str
    input_path: Path
    artifacts_dir: Path
    source_duration_sec: float
    deadline: float


class PipelineAdapter(Protocol):
    def initialize(self) -> None: ...
    def analyze(self, job_request: JobRequest) -> DecisionResult: ...
    def shutdown(self) -> None: ...


class MockPipelineAdapter:
    def __init__(self, settings):
        self.scenario = settings.mock_scenario

    def initialize(self):
        pass

    def analyze(self, job_request):
        if self.scenario == "failure":
            raise SentryError("PIPELINE_FAILED")
        violations = []
        if self.scenario == "violations":
            for timestamp in (0.0, job_request.source_duration_sec * 0.5):
                violations.append(DecisionViolation(
                    type="Demo event — not an AI finding", timecode_sec=timestamp,
                    description="Artificial development example. Demo frames are not evidence of a real violation.",
                    evidence_timestamps=[timestamp]))
        return DecisionResult(schema_version="1.0", complete=True,
                              source_duration_sec=job_request.source_duration_sec,
                              verdict="violation" if violations else "no_violation", violations=violations,
                              is_demo=True, provenance="deterministic-development-mock")

    def shutdown(self):
        pass


class RealPipelineAdapter:
    def __init__(self, settings):
        pass

    def initialize(self):
        raise SentryError("ML_NOT_CONFIGURED", 503)

    def analyze(self, job_request):
        raise SentryError("ML_NOT_CONFIGURED", 503)

    def shutdown(self):
        pass


def create_adapter(settings) -> PipelineAdapter:
    if settings.pipeline_mode == "mock":
        return MockPipelineAdapter(settings)
    if settings.pipeline_mode == "real":
        return RealPipelineAdapter(settings)
    raise SentryError("PIPELINE_DISABLED", 503)
