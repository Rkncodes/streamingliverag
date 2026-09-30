"""Retrieval service logic (phase 7): RetrievalRequest -> RetrievalResponse, over the frozen stack.

  mode "single"     generation.pipeline.retrieve: dense + BM25 -> RRF -> temporal resolution -> rerank -> top k
  mode "iterative"  adaptive.streaming.controller.IterativeRetriever (phase 6), max_rounds from the request

Nothing is re-implemented: the service holds the loaded RetrievalStack (indexes and models, loaded once) and calls
those two functions. It is the only process that loads them.
"""

from __future__ import annotations

import logging

from adaptive.streaming.controller import IterativeRetriever
from generation.pipeline import RetrievalStack, retrieve

from ..contracts import RetrievalRequest, RetrievalResponse

log = logging.getLogger(__name__)


class RetrievalService:
    def __init__(self, stack: RetrievalStack, aliases: dict[str, str] | None = None):
        self.stack, self.aliases = stack, aliases

    def handle(self, req: RetrievalRequest) -> RetrievalResponse:
        if req.mode == "iterative":
            r = IterativeRetriever(req.max_rounds, self.aliases)(self.stack, req.query, req.k)
        else:
            r = retrieve(self.stack, req.query, req.k)
        log.info("retrieve job=%s session=%s mode=%s evidence=%d%s", req.job_id, req.session_id, req.mode,
                 len(r.evidence), f" rounds={r.trace.iterations}" if getattr(r, "trace", None) else "")
        return RetrievalResponse.of(req, r)

    def health(self) -> dict:
        return {"status": "ok", "service": "retrieval", "chunks": len(self.stack.chunks),
                "reranker": self.stack.reranker is not None}
