"""Orchestrator (phase 7): composition only. It consumes phase 4 jobs and runs the phase 3 session controller (with
phases 2, 1 and optionally 6 under it), keeping sessions in the phase 5 store, and sends every retrieval to the
retrieval service and every answer to the generation service.

  controller = build_controller(catalog_stack(chunks), RetrievalClient(...), GenerationClient(...))
  worker = OrchestratorWorker(controller, broker, sessions=RedisSessionStore.from_env())
  worker.run()

Reused unchanged: adaptive.jobs.worker.Worker (lifecycle, events, failures, duplicate delivery), SessionController,
MultiIntentController, AdaptiveController, IterativeRetriever (inside the retrieval service), the session store and
its codec. The only additions are the correlation binding below and two drop-ins through existing hooks
(retriever=, answerer=).

The catalog is the corpus's chunk metadata (chunking.pipeline.load_chunks): decomposition and follow-up resolution
read the corpus organizations from it. No index and no model is loaded here; RetrievalStack's retrieval parts are
None, and the retriever passed in ignores the stack.
"""

from __future__ import annotations

import logging

from pydantic import ValidationError

from adaptive.jobs.contracts import JobRequest
from adaptive.jobs.worker import Worker
from adaptive.session.controller import SessionController
from generation.pipeline import RetrievalStack

from .. import correlation, telemetry
from ..generation.client import GenerationClient, NoLocalModel
from ..retrieval.client import RetrievalClient

log = logging.getLogger(__name__)


class OrchestratorWorker(Worker):
    """The phase 4 worker, with the job's ids bound while it is handled (services.correlation) and an
    orchestrator.execute span around it (phase 10A)."""

    def handle(self, body: bytes) -> None:
        try:
            req = JobRequest.decode(body)
        except ValidationError:
            return super().handle(body)  # the phase 4 worker reports or rejects it
        with correlation.bind(job_id=req.job_id, session_id=req.session_id):
            with telemetry.span("orchestrator.execute", telemetry.ORCHESTRATOR) as span:
                super().handle(body)
                self._outcome(span, req.job_id)

    def _outcome(self, span, job_id: str) -> None:
        """The job's final event on its span (phase 10A). The phase 4 worker reports a failed pipeline as an event,
        not as an exception, so the span's status is read from that event. Read only."""
        try:
            final = self.finished.get(job_id)
            if final is None:
                return
            span.set({"job.status": final.status.value})
            if final.result is not None:
                r = final.result
                span.set({"session.turn_index": r.turn_index, "session.continued": r.turn_index > 0,
                          "orchestrator.resolution": r.resolution, "orchestrator.answer_status": r.answer_status,
                          "orchestrator.abstention_reason": r.abstention_reason,
                          "orchestrator.citation_count": len(r.citations)})
            if final.error is not None:
                span.error(final.error.get("type") or "JobFailed")
        except Exception:
            log.debug("orchestrator span attributes failed; the job is not affected", exc_info=True)


def catalog_stack(chunks: list) -> RetrievalStack:
    return RetrievalStack(chunks, hybrid=None, reranker=None, resolver=None)


def load_catalog() -> RetrievalStack:
    from chunking.pipeline import load_chunks

    return catalog_stack([c for cs in load_chunks().values() for c in cs])


def build_controller(catalog: RetrievalStack, retrieval: RetrievalClient, generation: GenerationClient,
                     aliases: dict[str, str] | None = None) -> SessionController:
    return SessionController(catalog, NoLocalModel(), aliases, retriever=retrieval, answerer=generation)
