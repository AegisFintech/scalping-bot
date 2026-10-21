import hashlib

from fastapi import FastAPI, Request, Response

from python.analytics.models import (
    AnalyticsRequest,
    AnalyticsResponse,
    NumericAnalyticsRequest,
    NumericAnalyticsResponse,
    PerformanceRequest,
    PerformanceResponse,
)
from python.analytics.service import analyze, analyze_numeric
from python.analytics.statistics import summarize
from python.research.scalp_candidates import ScanReport, ScanRequest, scan
from python.technical.models import ContextRequest, ContextRequestV11, ContextResponse
from python.technical.service import prepare_context

app = FastAPI(
    title="cTrader AI Scalper Analytics",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
)


@app.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "alive"}


@app.get("/health/ready")
def ready() -> dict[str, str]:
    return {"status": "ready"}


@app.post("/v1/analyze", response_model=AnalyticsResponse, response_model_by_alias=True)
def analyze_request(request: AnalyticsRequest) -> AnalyticsResponse:
    return analyze(request)


@app.post(
    "/v2/analyze-numeric", response_model=NumericAnalyticsResponse, response_model_by_alias=True
)
def analyze_numeric_request(request: NumericAnalyticsRequest) -> NumericAnalyticsResponse:
    return analyze_numeric(request.request)


@app.post("/v1/performance", response_model=PerformanceResponse, response_model_by_alias=True)
def performance_request(request: PerformanceRequest) -> PerformanceResponse:
    return PerformanceResponse(request_id=request.request_id, summary=summarize(request.outcomes))


@app.post("/v1/technical-context", response_model=ContextResponse, response_model_by_alias=True)
def technical_context_request(request: ContextRequest) -> ContextResponse:
    return prepare_context(request)


@app.post("/v2/technical-context", response_model=ContextResponse, response_model_by_alias=True)
def technical_context_v11_request(request: ContextRequestV11) -> ContextResponse:
    return prepare_context(request)


@app.post("/v1/scalp-scan", response_model=ScanReport, response_model_by_alias=True)
async def scalp_scan_request(request: Request, response: Response, body: ScanRequest) -> ScanReport:
    response.headers["x-scalp-request-sha256"] = hashlib.sha256(await request.body()).hexdigest()
    return scan(body)
