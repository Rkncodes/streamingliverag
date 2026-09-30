"""Explicit session state (AdaptiveRAG phase 3): the turns of one conversation, nothing else.

A Turn keeps what the user asked, how the question was resolved against the session (adaptive.session.resolve),
and the phase 2 answer to the resolved query with its own citations. No evidence is carried from one turn to the
next: every answered turn retrieved and verified its own evidence. `reused_citations` only reports which cited
chunks the anchor turn had also cited.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from adaptive.multi.controller import MultiIntentAnswer

SELF_CONTAINED, FOLLOW_UP, UNRESOLVED = "self_contained", "follow_up", "unresolved"
UNRESOLVED_TEXT = ("This question refers to earlier context that cannot be resolved safely. Please ask it again with "
                   "the organization and the topic.")


@dataclass
class Resolution:
    kind: str  # self_contained | follow_up | unresolved
    reason: str
    query: str  # what the multi-intent controller receives ("" when unresolved)
    topic: list[str] = field(default_factory=list)  # the user questions a later follow-up is read with
    temporal: str = ""  # the temporal constraint in effect after this turn ("" = none), as the user wrote it
    organizations: list[str] = field(default_factory=list)  # corpus organizations the turn is about
    anchor: int | None = None  # index of the turn a follow-up was resolved against
    signals: dict = field(default_factory=dict)


@dataclass
class Turn:
    index: int
    question: str  # verbatim
    resolution: Resolution
    answer: MultiIntentAnswer | None  # None: unresolved (no retrieval, no model call)
    reused_citations: list[str] = field(default_factory=list)  # cited chunks the anchor turn cited as well

    @property
    def status(self) -> str:
        return self.answer.status if self.answer else "abstained"

    @property
    def text(self) -> str:
        return self.answer.text if self.answer else UNRESOLVED_TEXT

    @property
    def citations(self) -> list:
        return self.answer.citations if self.answer else []

    @property
    def cited_chunks(self) -> list[str]:
        return [c.chunk_id for c in self.citations]

    @property
    def intents(self) -> int:
        """How many questions this turn asked (0 when unresolved)."""
        if self.answer is None:
            return 0
        return len(self.answer.decomposition["intents"]) if self.answer.decomposition["multi"] else 1

    def to_dict(self) -> dict:
        return {"index": self.index, "question": self.question, "resolution": asdict(self.resolution),
                "status": self.status, "text": self.text, "reused_citations": self.reused_citations,
                "answer": self.answer.to_dict() if self.answer else None}

    def render(self) -> str:
        if self.answer is None:
            return f"{UNRESOLVED_TEXT}\n({self.resolution.reason})"
        return self.answer.render()


@dataclass
class Session:
    turns: list[Turn] = field(default_factory=list)

    @property
    def last(self) -> Turn | None:
        return self.turns[-1] if self.turns else None

    def to_dict(self) -> dict:
        return {"turns": [t.to_dict() for t in self.turns]}
