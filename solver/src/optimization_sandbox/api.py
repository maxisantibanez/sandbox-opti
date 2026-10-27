"""HTTP boundary for the Optimization Sandbox solver."""

import os
from dataclasses import asdict

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from . import __version__
from .highs_solver import solve_model
from .schema import OptimizationModel, OptimizationResult
from .validation import ValidationIssue, validate_model

_DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"


class InvalidModelError(Exception):
    """Raised when a structurally valid payload violates model rules."""

    def __init__(self, issues: list[ValidationIssue]) -> None:
        super().__init__("The optimization model is invalid.")
        self.issues = issues


def _cors_origins() -> list[str]:
    raw_origins = os.getenv("CORS_ORIGINS", _DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


app = FastAPI(
    title="Optimization Sandbox Solver",
    description="Stateless linear programming solver API backed by HiGHS.",
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(InvalidModelError)
async def handle_invalid_model(
    _request: Request,
    error: InvalidModelError,
) -> JSONResponse:
    return _invalid_model_response(error.issues)


@app.exception_handler(RequestValidationError)
async def handle_request_validation(
    _request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    issues = [
        ValidationIssue(
            path=_format_location(item.get("loc", ())),
            message=item.get("msg", "Invalid value."),
        )
        for item in error.errors()
    ]
    return _invalid_model_response(issues)


def _invalid_model_response(issues: list[ValidationIssue]) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "invalid_model",
                "message": "The optimization model is invalid.",
                "issues": [asdict(issue) for issue in issues],
            }
        },
    )


def _format_location(location: tuple[object, ...]) -> str:
    path = ""
    for part in location:
        if part == "body":
            continue
        if isinstance(part, int):
            path += f"[{part}]"
        elif path:
            path += f".{part}"
        else:
            path = str(part)
    return path or "model"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/solve",
    response_model=OptimizationResult,
    responses={422: {"description": "Invalid optimization model"}},
)
def solve(model: OptimizationModel) -> OptimizationResult:
    issues = validate_model(model)
    if issues:
        raise InvalidModelError(issues)
    return solve_model(model)
