"""API HTTP interface (phase 7). Routes validate and delegate; no retrieval, answering or session logic lives here.

  GET  /health   {"status": "ok", "service": "api"}
  POST /query    QueryRequest {"session_id", "question", "request_id"?} -> QueryResponse
                 200 completed (answered or abstained) | 422 invalid request | 502 the job failed | 504 no result in time
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Response

from .. import telemetry
from ..contracts import QueryRequest, QueryResponse
from ..orchestrator.client import OrchestratorClient, QueryTimeout


def create_app(orchestrator: OrchestratorClient) -> FastAPI:
    app = FastAPI(title="AdaptiveRAG API", version="1")
    app.add_middleware(telemetry.TracingMiddleware, service=telemetry.API)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "service": "api"}

    @app.post("/query", response_model=QueryResponse)
    def query(req: QueryRequest, response: Response) -> QueryResponse:
        try:
            out = orchestrator.query(req)
        except QueryTimeout as e:
            raise HTTPException(status_code=504, detail=str(e)) from e
        if out.status == "failed":
            response.status_code = 502
        return out

    return app
