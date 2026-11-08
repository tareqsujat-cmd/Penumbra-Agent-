"""Science errors; the API turns each into {error: {code, message, detail}} (IMPLEMENTATION_PLAN §4)."""
from __future__ import annotations


class PenumbraError(Exception):
    code = "COMPUTE_FAILED"
    status = 500

    def __init__(self, message: str, **detail):
        super().__init__(message)
        self.message = message
        self.detail = detail


class DatasetMissing(PenumbraError):
    code = "DATASET_MISSING"
    status = 503


class OutOfCoverage(PenumbraError):
    code = "OUT_OF_COVERAGE"
    status = 422


class KernelMissing(PenumbraError):
    code = "KERNEL_MISSING"
    status = 503


class DateOutOfRange(PenumbraError):
    code = "DATE_OUT_OF_RANGE"
    status = 422


class InvalidUncertainty(PenumbraError):
    code = "INVALID_UNCERTAINTY"
    status = 422


class UnknownSite(PenumbraError):
    code = "UNKNOWN_SITE"
    status = 404
