"""Generation service logic (phase 7): GenerationRequest -> GenerationResponse.

The frozen generation.answer.GroundedAnswerer, unchanged, on the evidence in the request: the relevance gate, context
assembly, the prompt, the model call and the verifier all run here, so the grounding contract (answer only from the
supplied evidence, abstain otherwise, cite what was verified) is enforced where the model is called. The service
never retrieves. It is the only process that holds the model provider (and its credentials).
"""

from __future__ import annotations

import logging

from generation.answer import GroundedAnswerer
from generation.providers import LLMProvider

from ..contracts import GenerationRequest, GenerationResponse

log = logging.getLogger(__name__)


class GenerationService:
    def __init__(self, provider: LLMProvider):
        self.provider = provider
        self.answerer = GroundedAnswerer(provider)

    def handle(self, req: GenerationRequest) -> GenerationResponse:
        a = self.answerer.answer(req.question, [e.evidence() for e in req.evidence],
                                 question_versions=req.question_versions)
        log.info("generate job=%s session=%s evidence=%d status=%s%s", req.job_id, req.session_id, len(req.evidence),
                 a.status, f" ({a.abstention_reason})" if a.abstention_reason else "")
        return GenerationResponse(**req.ids(), answer=a)

    def health(self) -> dict:
        return {"status": "ok", "service": "generation", "provider": getattr(self.provider, "name", None),
                "model": getattr(self.provider, "model", None)}
