"""Typed request models (Instructions §35). Field names follow the TypeScript contracts in src/types."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .config import DEFAULT_YEAR


class XY(BaseModel):
    x: float = Field(ge=-5000, le=5000)
    y: float = Field(ge=-5000, le=5000)


class Uncertainty(BaseModel):
    kind: Literal["circular", "gaussian"]
    radius: float = 100.0
    sigmaE: float = 50.0
    sigmaN: float = 50.0
    rotDeg: float = 0.0
    conf: float = Field(0.95, gt=0.0, lt=1.0)


class Window(BaseModel):
    startIdx: int = Field(ge=0)
    hours: int = Field(ge=24, le=8784)


class RiskRequest(BaseModel):
    site: str
    aim: XY
    model: Uncertainty
    enabled: bool = True
    percentile: Literal[50, 20, 10, 5] = 10
    seed: int = 7
    n: int = Field(2000, ge=200, le=20000)
    year: int = Field(DEFAULT_YEAR, ge=1950, le=2120)
    earthMarginDeg: float = Field(2.0, ge=0.0, le=10.0)
    dsnMaskDeg: float = Field(6.0, ge=0.0, le=30.0)
    window: Optional[Window] = None


class RobustRequest(RiskRequest):
    searchRadius: float = Field(450.0, ge=20.0, le=700.0)
    slopeMaxDeg: Optional[float] = Field(None, ge=1.0, le=45.0)


class Panel(BaseModel):
    azOffsetDeg: float
    watts: float = Field(ge=0, le=20000)


class VehicleIn(BaseModel):
    panels: list[Panel] = Field(min_length=1, max_length=8)
    batteryWh: float = Field(gt=0, le=1e6)
    baseLoadW: float = Field(ge=0, le=1e5)
    hibernateW: float = Field(ge=0, le=1e5)
    reservePct: float = Field(ge=0, le=90)


class VisibilityRequest(BaseModel):
    site: str
    aim: XY
    startIdx: int = Field(ge=0)
    hours: int = Field(ge=1, le=8784)
    earthMarginDeg: float = Field(2.0, ge=0.0, le=10.0)
    dsnMaskDeg: float = Field(6.0, ge=0.0, le=30.0)
    vehicle: VehicleIn
    headingDeg: float = 0.0
    autoHeading: bool = True
    year: int = Field(DEFAULT_YEAR, ge=1950, le=2120)
    mast: float = Field(2.0, ge=0.5, le=20.0)


class EnduranceRequest(BaseModel):
    site: str
    aim: XY
    windowDays: int = Field(90, ge=7, le=180)
    stepDays: int = Field(1, ge=1, le=30)
    vehicle: VehicleIn
    year: int = Field(DEFAULT_YEAR, ge=1950, le=2120)
    mast: float = Field(2.0, ge=0.5, le=20.0)


class CompareRequest(BaseModel):
    sites: list[str] = Field(min_length=2, max_length=5)  # 2-4 per the brief, or all five sites at once
    model: Uncertainty
    percentile: Literal[50, 20, 10, 5] = 10
    startIdx: int = Field(0, ge=0)
    windowDays: int = Field(30, ge=1, le=365)
    earthMarginDeg: float = Field(2.0, ge=0.0, le=10.0)
    dsnMaskDeg: float = Field(6.0, ge=0.0, le=30.0)
    vehicle: VehicleIn
    year: int = Field(DEFAULT_YEAR, ge=1950, le=2120)
    searchRadius: float = Field(450.0, ge=20.0, le=700.0)

    @field_validator("sites")
    @classmethod
    def distinct(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("sites must be distinct")
        return v
