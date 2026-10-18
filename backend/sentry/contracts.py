"""Proposed backend boundary; NOT the visual pipeline's result.json schema."""
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class DecisionViolation(StrictModel):
    type: str = Field(min_length=1, max_length=200)
    timecode_sec: float = Field(ge=0)
    description: str = Field(min_length=1, max_length=4000)
    evidence_timestamps: list[float] = Field(min_length=1, max_length=3)
    regulatory_references: list[dict[str, Any]] | None = None


class DecisionResult(StrictModel):
    schema_version: Literal["1.0"]
    complete: Literal[True]
    source_duration_sec: float = Field(gt=0)
    verdict: Literal["violation", "no_violation"]
    violations: list[DecisionViolation] = Field(max_length=100)
    is_demo: bool
    provenance: str = Field(min_length=1, max_length=200)

    @field_validator("complete", mode="before")
    @classmethod
    def explicitly_complete(cls, value):
        if value is not True:
            raise ValueError("Completion must be the boolean true")
        return value

    @model_validator(mode="after")
    def final_decision(self):
        if (self.verdict == "violation") != bool(self.violations):
            raise ValueError("Verdict and violations disagree")
        for violation in self.violations:
            for timestamp in [violation.timecode_sec, *violation.evidence_timestamps]:
                if not math.isfinite(timestamp) or not 0 <= timestamp < self.source_duration_sec:
                    raise ValueError("Timestamp must lie within the source video")
        return self


class EvidenceFrame(StrictModel):
    frame_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    timestamp_sec: float = Field(ge=0)
    requested_timestamp_sec: float = Field(ge=0)
    selection_offset_sec: float
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class FinalResult(StrictModel):
    decision: DecisionResult
    evidence: list[list[EvidenceFrame]]

    @model_validator(mode="after")
    def complete_evidence(self):
        if len(self.evidence) != len(self.decision.violations):
            raise ValueError("Missing evidence")
        for violation, frames in zip(self.decision.violations, self.evidence):
            if len(frames) != len(violation.evidence_timestamps):
                raise ValueError("Missing requested evidence")
            for requested, frame in zip(violation.evidence_timestamps, frames):
                if not 0 <= frame.timestamp_sec < self.decision.source_duration_sec:
                    raise ValueError("Invalid extracted timestamp")
                if abs(requested - frame.requested_timestamp_sec) > 1e-6:
                    raise ValueError("Wrong evidence request")
                if abs(frame.timestamp_sec - requested - frame.selection_offset_sec) > 1e-6:
                    raise ValueError("Unrecorded frame selection offset")
        return self
