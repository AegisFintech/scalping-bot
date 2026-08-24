from fastapi import FastAPI

from python.analytics.models import (
    AnalyticsRequest,
    AnalyticsResponse,
    PerformanceRequest,
    PerformanceResponse,
)
from python.analytics.service import analyze
from python.analytics.statistics import summarize

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


@app.post("/v1/performance", response_model=PerformanceResponse, response_model_by_alias=True)
def performance_request(request: PerformanceRequest) -> PerformanceResponse:
    return PerformanceResponse(request_id=request.request_id, summary=summarize(request.outcomes))
