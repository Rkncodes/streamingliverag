"""Session-aware controller (AdaptiveRAG phase 3), above the multi-intent controller (phase 2), unchanged.

  controller = SessionController(stack, provider)
  session = Session()
  turn = controller.ask(session, "What is UConn's University Travel Card suspension rule?")
  turn = controller.ask(session, "Does that apply currently?")

  question -> resolve against session.last (adaptive.session.resolve; rules, no model)
     self_contained -> MultiIntentController.run(question)          exactly phase 2
     follow_up      -> MultiIntentController.run(rewritten query)   phase 2 on one standalone query
     unresolved     -> abstain: no retrieval, no model call
  -> Turn appended to the session

Every answered turn retrieves, answers and verifies its own evidence; its citations are its own. Nothing here
changes retrieval, temporal resolution, the prompt, the verifier, phase 1 or phase 2.
"""

from __future__ import annotations

from adaptive.multi.controller import MultiIntentController
from generation.pipeline import RetrievalStack
from generation.providers import LLMProvider

from .resolve import resolve
from .state import UNRESOLVED, Session, Turn


class SessionController:
    def __init__(self, stack: RetrievalStack, provider: LLMProvider, aliases: dict[str, str] | None = None,
                 retriever=None):
        # retriever: None = the frozen retrieval; phase 6 passes its iterative retriever (current turn only)
        self.multi = MultiIntentController(stack, provider, aliases, retriever)

    def ask(self, session: Session, question: str) -> Turn:
        last = session.last
        r = resolve(question, last, self.multi.organizations, self.multi.aliases)
        answer = None if r.kind == UNRESOLVED else self.multi.run(r.query)
        turn = Turn(len(session.turns), question, r, answer)
        if answer is not None and r.anchor is not None:
            earlier = set(session.turns[r.anchor].cited_chunks)
            turn.reused_citations = [c for c in turn.cited_chunks if c in earlier]
        session.turns.append(turn)
        return turn
