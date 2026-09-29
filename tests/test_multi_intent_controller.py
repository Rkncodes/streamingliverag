"""Multi-intent controller (offline): coverage gate, per-intent retrieval, fusion, traceability, per-intent versions,
unsupported intents, citations, and phase 1 unchanged. No network, no models.

The frozen pipeline (generation.pipeline.retrieve, temporal resolution, assemble, GroundedAnswerer, verify) runs
unchanged over a keyword-overlap stand-in for dense + BM25 + RRF and the cross-encoder, so that different questions
retrieve different chunks (the fakes in tests/test_generation_verification.py return every chunk in list order).
"""

import re

import numpy as np

from adaptive.controller import SINGLE, AdaptiveController
from adaptive.multi.controller import DELEGATE, FUSED, PER_INTENT, MultiIntentController
from adaptive.multi.fusion import fuse, retrieve_intent
from adaptive.multi.decompose import decompose
from generation import config as C
from generation.context import assemble
from generation.pipeline import RetrievalStack, retrieve
from generation.providers import StubProvider
from retrieval.hybrid import Fused
from retrieval.rerank import RerankedHybridRetriever
from temporal.resolve import TemporalResolver
from tests.test_generation import answered, mk
from tests.test_generation_verification import version

STOP = {"what", "is", "the", "to", "and", "if", "a", "an", "of", "be", "must", "how", "when", "does", "do", "are",
        "for", "in", "on", "with", "that", "this", "it", "may", "did", "say", "about"}


def toks(text):
    return set(re.findall(r"[a-z0-9]+", text.lower())) - STOP


class KeywordHybrid:
    """Ranks chunks by word overlap with the query (stands in for dense + BM25 + RRF)."""

    def __init__(self, chunks):
        self.chunks = chunks

    def fuse(self, query):
        q = toks(query)
        order = sorted(range(len(self.chunks)), key=lambda i: (-len(q & toks(self.chunks[i].retrieval_text)), i))
        return [Fused(i, 1.0 / (r + 1), {"dense": r + 1}) for r, i in enumerate(order)]


class KeywordCrossEncoder:
    """Logit = overlap - 2: two shared words or fewer is below MIN_RERANK_LOGIT (0.0)."""

    def predict(self, pairs, **kw):
        return np.array([float(len(toks(q) & toks(p)) - 2) for q, p in pairs])


def stack(*chunks):
    chunks = list(chunks)
    hybrid = KeywordHybrid(chunks)
    return RetrievalStack(chunks, hybrid, RerankedHybridRetriever(hybrid, KeywordCrossEncoder()),
                          TemporalResolver.from_chunks(chunks))


ALIASES = {"TU": "Test University"}

DEADLINE = mk("dl", "Card charges are due 30 days after the trip.")
PENALTY = mk("pn", "Statements that stay unresolved lead to suspension of the card.")
FILLERS = [mk(f"f{i}", f"Deadline notice n{i}: submit card charges and statements promptly.") for i in range(6)]
BOATS = "what is the mileage rate for rental boats"

Q_ONE = "What is the deadline to submit card charges?"
Q_TWO = "What is the deadline to submit card charges, and what happens if statements stay unresolved?"
Q_THREE = ("What is the deadline to submit card charges, what happens if statements stay unresolved, and "
           f"{BOATS}?")


def label_of(user, chunk):
    m = re.search(r"\[(S\d+)\][^\n]*chunk: " + re.escape(chunk.chunk_id) + r"\b", user)
    return m.group(1) if m else None


def question_of(user):
    return user.split("\n", 1)[0]


def two_part_script(gaps=None, fabricate=False):
    """Answers the deadline from a filler and the penalty from PENALTY, when their sources are in the prompt."""

    def script(system, user):
        claims = []
        f, p = label_of(user, FILLERS[0]), label_of(user, PENALTY)
        if f:
            claims.append(("A deadline notice asks to submit card charges promptly", [f], ["submit card charges and statements promptly"]))
        if p:
            claims.append(("Unresolved statements lead to suspension of the card", [p], ["stay unresolved lead to suspension of the card"]))
        if fabricate and f:
            claims.append(("Rental boats are reimbursed at 50 cents per mile", [f], ["Rental boats are reimbursed at 50 cents per mile"]))
        if not claims:
            return {"status": "insufficient_evidence", "claims": [], "not_in_sources": [], "abstention_reason": "none"}
        out = answered(*claims)
        if gaps:
            out["not_in_sources"] = gaps
        return out

    return script


def run_both(st, script, q):
    p1, p2 = StubProvider(script), StubProvider(script)
    a1 = AdaptiveController(st, p1).run(q)
    a2 = MultiIntentController(st, p2, ALIASES).run(q)
    return a1, p1, a2, p2


# ---------------------------------------------------------------- single intent: phase 1 unchanged


def test_single_intent_is_phase_1_exactly():
    st = stack(DEADLINE, PENALTY, *FILLERS)
    a1, p1, a2, p2 = run_both(st, two_part_script(), Q_ONE)
    assert a2.strategy == DELEGATE and not a2.decomposition["multi"]
    assert p2.calls == p1.calls and len(p1.calls) == 1  # identical model input
    assert a2.phase1[0].to_dict() == a1.to_dict()  # identical phase 1 answer
    assert (a2.status, a2.text, a2.citations, a2.abstention_reason) == (a1.status, a1.text, a1.citations, a1.abstention_reason)
    assert [i["status"] for i in a2.intents] == ["answered"] and a2.intents[0]["sub_query"] == Q_ONE


def test_phase_1_split_decision_is_untouched_for_single_intent_questions():
    from tests.test_adaptive_controller import card_script
    from tests.test_generation_verification import FEB_CARD, JUL_CARD, NEUTRAL_Q

    st = stack(FEB_CARD, JUL_CARD)
    a1, p1, a2, p2 = run_both(st, card_script(), NEUTRAL_Q)
    assert p2.calls == p1.calls and a2.phase1[0].to_dict() == a1.to_dict()
    assert a2.phase1[0].decision.strategy == a1.decision.strategy


# ---------------------------------------------------------------- coverage gate


def test_gate_delegates_when_the_question_context_covers_every_intent():
    st = stack(DEADLINE, PENALTY, mk("x", "Unrelated text."))
    assert assemble(retrieve(st, Q_TWO).evidence).by_label()  # everything fits in one context
    a1, p1, a2, p2 = run_both(st, two_part_script(), Q_TWO)
    assert a2.decomposition["multi"] and a2.strategy == DELEGATE and "phase 1 unchanged" in a2.reason
    assert p2.calls == p1.calls and a2.phase1[0].to_dict() == a1.to_dict()
    assert all(i["covered_by_question_context"] for i in a2.intents)
    assert [i["top_chunk"] for i in a2.intents] == [DEADLINE.chunk_id, PENALTY.chunk_id]


def test_gate_fuses_when_an_intent_is_missing_from_the_question_context():
    st = stack(DEADLINE, PENALTY, *FILLERS)
    r0 = retrieve(st, Q_TWO)
    assert PENALTY.chunk_id not in [s.chunk.chunk_id for s in assemble(r0.evidence).sources]  # phase 1 misses it
    a1, p1, a2, p2 = run_both(st, two_part_script(), Q_TWO)
    assert PENALTY.chunk_id not in p1.calls[0][1]
    assert a2.strategy == FUSED and len(p2.calls) == 1
    user = p2.calls[0][1]
    assert PENALTY.chunk_id in user and FILLERS[0].chunk_id in user  # both intents' evidence in one context
    assert question_of(user).endswith(Q_TWO)  # the model sees the original question, not a sub-query
    assert a2.status == "answered" and len(a2.claims) == 2
    assert [cl["intents"] for cl in a2.claims] == [[0], [1]]
    assert [i["covered_by_question_context"] for i in a2.intents] == [True, False]
    assert [i["status"] for i in a2.intents] == ["answered", "answered"]


# ---------------------------------------------------------------- per-intent retrieval and fusion


def test_each_intent_uses_the_frozen_retrieve_with_its_sub_query():
    st = stack(DEADLINE, PENALTY, *FILLERS)
    a = MultiIntentController(st, StubProvider(two_part_script()), ALIASES).run(Q_TWO)
    subs = [i.sub_query for i in decompose(Q_TWO, {"Test University"}, ALIASES).intents]
    assert [i["sub_query"] for i in a.intents] == subs
    for rec, sub in zip(a.intents, subs):
        assert rec["retrieved"] == [e.chunk.chunk_id for e in retrieve(st, sub).evidence]


def test_fusion_interleaves_by_rank_and_keeps_every_intent_of_a_chunk():
    st = stack(DEADLINE, PENALTY, *FILLERS)
    runs = [retrieve_intent(st, i) for i in decompose(Q_TWO, set(), ALIASES).intents]
    f = fuse(runs)
    ids = [e.chunk.chunk_id for e in f.evidence]
    assert [e.rank for e in f.evidence] == list(range(1, len(ids) + 1)) and len(ids) == len(set(ids))
    assert ids[0] == runs[0].top.chunk_id and ids[1] == runs[1].top.chunk_id  # intent 1 rank 1, intent 2 rank 1
    both = [cid for cid, xs in f.intents_of.items() if {x["intent"] for x in xs} == {0, 1}]
    assert both  # fillers are retrieved by both intents: recorded twice, placed once
    assert len(assemble(f.evidence).sources) <= C.MAX_SOURCES  # the unchanged context limits apply


def test_fused_answer_keeps_phase_1_citations_and_text():
    st = stack(DEADLINE, PENALTY, *FILLERS)
    a = MultiIntentController(st, StubProvider(two_part_script()), ALIASES).run(Q_TWO)
    p1 = a.phase1[0]
    assert a.text == p1.text and a.citations == p1.citations  # numbering and rendering untouched
    cited = {c.number: c.chunk_id for c in a.citations}
    assert a.citation_intents == {n: ([1] if cid == PENALTY.chunk_id else [0]) for n, cid in cited.items()}
    # a filler is in both intents' top 10, but only the deadline intent scores it as relevant
    assert {x["intent"] for x in a.evidence_intents[FILLERS[0].chunk_id]} == {0, 1}
    assert set(a.evidence_intents) == {s["chunk_id"] for s in p1.sources_considered}


# ---------------------------------------------------------------- unsupported and partial intents


def test_an_unsupported_intent_contributes_no_evidence_and_is_reported():
    st = stack(DEADLINE, PENALTY, *FILLERS)
    stub = StubProvider(two_part_script(gaps=["the mileage rate for rental boats"]))
    a = MultiIntentController(st, stub, ALIASES).run(Q_THREE)
    assert a.decomposition["multi"] and len(a.intents) == 3 and a.strategy == FUSED and len(stub.calls) == 1
    boats = a.intents[2]
    assert not boats["admissible"] and boats["status"] == "unsupported" and boats["citations"] == []
    assert all(x["intent"] != 2 for xs in a.evidence_intents.values() for x in xs)
    assert a.status == "answered" and a.not_in_sources == ["the mileage rate for rental boats"]
    assert "rental boats" in a.text and all(2 not in cl["intents"] for cl in a.claims)


def test_an_answer_invented_for_an_unsupported_intent_is_rejected_by_the_verifier():
    st = stack(DEADLINE, PENALTY, *FILLERS)
    a = MultiIntentController(st, StubProvider(two_part_script(fabricate=True)), ALIASES).run(Q_THREE)
    assert a.strategy == FUSED and a.status == "abstained" and a.abstention_reason == "ungrounded_output"
    assert any("quote not found" in p for p in a.verification_problems)
    assert a.citations == [] and a.claims == []


def test_no_admissible_intent_goes_to_phase_1_unchanged():
    st = stack(DEADLINE, PENALTY, *FILLERS)
    q = "What is the mileage rate for rental boats, and which airline serves remote islands?"
    a1, p1, a2, p2 = run_both(st, two_part_script(), q)
    assert a2.decomposition["multi"] and a2.strategy == DELEGATE
    assert "no intent retrieved admissible evidence" in a2.reason
    assert p2.calls == p1.calls and a2.phase1[0].to_dict() == a1.to_dict()
    assert [i["status"] for i in a2.intents] == ["unsupported", "unsupported"]


# ---------------------------------------------------------------- versions per intent

SERIES_FEB_SUSP = version("susp", "February procedures: card suspension follows 60 days of unsubmitted charges.",
                          "proc-feb", "2026-02-01", superseded="2026-07-01", current=False)
SERIES_JUL_SUSP = version("susp", "July procedures: card suspension follows 60 days of unapproved charges.",
                          "proc-jul", "2026-07-01", current=True)
JUL_BED = version("bed", "Multi-bedroom lodging booked by travelers must be paid personally.", "proc-jul",
                  "2026-07-01", current=True)
Q_MIXED = ("What did the February 2026 procedures say about card suspension, and may travelers currently book "
           "multi-bedroom lodging?")


def version_script(system, user):
    claims = []
    for chunk, text, quote in [(SERIES_FEB_SUSP, "Card suspension follows 60 days of unsubmitted charges",
                                "card suspension follows 60 days of unsubmitted charges"),
                               (JUL_BED, "Multi-bedroom lodging must be paid personally",
                                "must be paid personally")]:
        label = label_of(user, chunk)
        if label:
            claims.append((text, [label], [quote]))
    return answered(*claims) if claims else {"status": "insufficient_evidence", "claims": [], "not_in_sources": [],
                                             "abstention_reason": "none"}


def test_each_intent_resolves_its_own_versions_and_conflicts_are_answered_per_intent():
    st = stack(SERIES_FEB_SUSP, SERIES_JUL_SUSP, JUL_BED)
    r0 = retrieve(st, Q_MIXED)
    assert r0.resolution.intent.kind == "point_in_time" and JUL_BED.chunk_id in r0.resolution.dropped  # phase 1 loses it
    stub = StubProvider(version_script)
    a = MultiIntentController(st, stub, ALIASES).run(Q_MIXED)
    assert [i["temporal_intent"] for i in a.intents] == ["point_in_time", "current"]
    assert [i["selected_versions"] for i in a.intents] == [{"uni-travel-procedures": ["proc-feb"]},
                                                          {"uni-travel-procedures": ["proc-jul"]}]
    assert a.strategy == PER_INTENT and len(stub.calls) == 2
    (_, u1), (_, u2) = stub.calls
    assert SERIES_FEB_SUSP.chunk_id in u1 and SERIES_JUL_SUSP.chunk_id not in u1 and JUL_BED.chunk_id not in u1
    assert JUL_BED.chunk_id in u2 and SERIES_FEB_SUSP.chunk_id not in u2
    assert question_of(u1).endswith(a.intents[0]["sub_query"]) and question_of(u2).endswith(a.intents[1]["sub_query"])
    assert a.status == "answered" and [cl["intents"] for cl in a.claims] == [[0], [1]]
    assert a.text.splitlines()[0].startswith("Part 1 (What did the February 2026 procedures")
    assert a.text.splitlines()[1].startswith("Part 2 (may travelers currently book multi-bedroom lodging?)")
    assert [c.number for c in a.citations] == [1, 2] and len({c.chunk_id for c in a.citations}) == 2  # renumbered
    assert "[1]" in a.text.splitlines()[0] and "[2]" in a.text.splitlines()[1]
    assert a.citation_intents == {1: [0], 2: [1]}


def test_a_shared_date_scope_keeps_one_fused_verification_call():
    st = stack(SERIES_FEB_SUSP, SERIES_JUL_SUSP, *FILLERS, JUL_BED)  # the whole question's context misses JUL_BED
    q = ("Under the procedures effective July 1, 2026, what is the deadline to submit card charges, and may travelers "
         "book multi-bedroom lodging?")
    seen = []
    ctl = MultiIntentController(st, StubProvider(version_script), ALIASES)
    orig = ctl.phase1.answer
    ctl.phase1.answer = lambda r: seen.append(r) or orig(r)
    a = ctl.run(q)
    assert [i["temporal_intent"] for i in a.intents] == ["point_in_time", "point_in_time"]
    assert a.strategy == FUSED and len(seen) == 1
    assert seen[0].question_versions == {"uni-travel-procedures": ["proc-jul"]}  # the whole question's selection
    assert SERIES_FEB_SUSP.chunk_id not in [e.chunk.chunk_id for e in seen[0].evidence]  # filtered per intent


def test_per_intent_skips_the_model_for_an_unsupported_intent():
    st = stack(SERIES_FEB_SUSP, SERIES_JUL_SUSP, JUL_BED)
    q = Q_MIXED[:-1] + f", and {BOATS}?"
    stub = StubProvider(version_script)
    a = MultiIntentController(st, stub, ALIASES).run(q)
    assert a.strategy == PER_INTENT and len(a.intents) == 3 and len(stub.calls) == 2
    assert a.intents[2]["status"] == "unsupported"
    assert a.text.splitlines()[2] == f"Part 3 ({BOATS}?): no relevant evidence was retrieved for this part."
    assert any(g.startswith("Part 3") for g in a.not_in_sources)


def test_per_intent_all_parts_abstaining_is_an_abstention():
    st = stack(SERIES_FEB_SUSP, SERIES_JUL_SUSP, JUL_BED)
    none = lambda s, u: {"status": "insufficient_evidence", "claims": [], "not_in_sources": [], "abstention_reason": "x"}  # noqa: E731
    a = MultiIntentController(st, StubProvider(none), ALIASES).run(Q_MIXED)
    assert a.strategy == PER_INTENT and a.status == "abstained" and a.text == C.ABSTENTION_TEXT
    assert a.abstention_reason == "model_insufficient_evidence" and a.citations == []
    assert [i["status"] for i in a.intents] == ["not_answered", "not_answered"]


# ---------------------------------------------------------------- phase 1 and the frozen path


def test_phase_1_strategy_inside_the_fused_path_is_phase_1s():
    st = stack(DEADLINE, PENALTY, *FILLERS)
    a = MultiIntentController(st, StubProvider(two_part_script()), ALIASES).run(Q_TWO)
    assert a.phase1[0].decision.strategy == SINGLE  # no versions: phase 1 keeps the single path


def test_phase_1_public_interface_is_unchanged():
    import inspect

    from adaptive import controller as p1

    assert list(inspect.signature(p1.AdaptiveController.run).parameters) == ["self", "query"]
    assert list(inspect.signature(p1.AdaptiveController.answer).parameters) == ["self", "r"]
    assert (p1.SINGLE, p1.SPLIT) == ("single", "split_by_version")


def test_to_dict_is_json_serializable():
    import json

    st = stack(DEADLINE, PENALTY, *FILLERS)
    a = MultiIntentController(st, StubProvider(two_part_script()), ALIASES).run(Q_TWO)
    d = json.loads(json.dumps(a.to_dict()))
    assert d["strategy"] == FUSED and d["citation_intents"] and d["phase1"][0]["decision"]["strategy"] == SINGLE


# ---------------------------------------------------------------- organization boundary

BIDS = mk("bids", "Competitive bids are required for purchases over 50000 at this university.", org="Other University",
          doc="doc-o")
EXTRAS = [mk(f"e{i}", f"Statements archive note e{i}.") for i in range(4)]
ORG_STACK = (DEADLINE, PENALTY, *FILLERS, *EXTRAS, BIDS)  # BIDS last: outside the penalty intent's own top 10
Q_HARVARD = ("What happens if statements stay unresolved, and what purchase amount requires competitive bids at "
             "Harvard University?")
Q_OTHER = ("What happens if statements stay unresolved, and what purchase amount requires competitive bids at "
           "Other University?")
BID_QUOTE = "Competitive bids are required for purchases over 50000"


def org_script(fabricate=False, gaps=None):
    """Answers the penalty from PENALTY and the bid amount from BIDS whenever those sources are in the prompt.
    fabricate: with BIDS absent, still states the bid rule, citing the penalty source."""

    def script(system, user):
        claims = []
        p, b = label_of(user, PENALTY), label_of(user, BIDS)
        if p:
            claims.append(("Unresolved statements lead to suspension of the card", [p], ["stay unresolved lead to suspension of the card"]))
        if b:
            claims.append(("Competitive bids are required for purchases over 50000", [b], [BID_QUOTE]))
        elif fabricate and p:
            claims.append(("Harvard requires competitive bids for purchases over 50000", [p], [BID_QUOTE]))
        out = answered(*claims) if claims else insufficient_out()
        if gaps and claims:
            out["not_in_sources"] = gaps
        return out

    return script


def insufficient_out():
    return {"status": "insufficient_evidence", "claims": [], "not_in_sources": [], "abstention_reason": "none"}


def test_boundary_in_corpus_organization_uses_its_evidence_and_keeps_the_gate():
    st = stack(*ORG_STACK)
    d = MultiIntentController(st, StubProvider(org_script()), ALIASES).decompose(Q_OTHER)
    assert d.multi and d.intents[1].organizations == ["Other University"] and d.intents[1].outside_corpus == []
    a1, p1, a2, p2 = run_both(st, org_script(), Q_OTHER)
    assert a2.strategy == DELEGATE and p2.calls == p1.calls  # covered by the question's context: phase 1 unchanged
    assert a2.intents[1]["admissible"] and a2.intents[1]["status"] == "answered"
    bid = [c.number for c in a2.citations if c.chunk_id == BIDS.chunk_id]
    assert bid and a2.citation_intents[bid[0]] == [1]


def test_boundary_out_of_corpus_intent_is_unsupported_and_other_evidence_is_withheld():
    st = stack(*ORG_STACK)
    a1, p1, a2, p2 = run_both(st, org_script(gaps=["the purchase amount that requires competitive bids at Harvard "
                                                    "University"]), Q_HARVARD)
    assert BIDS.chunk_id in p1.calls[0][1]  # phase 1 (whole question) would show another organization's bid rule
    h = a2.intents[1]
    assert h["outside_corpus"] == ["Harvard University"] and not h["admissible"] and h["status"] == "unsupported"
    assert h["best_rerank"] >= C.MIN_RERANK_LOGIT  # the reranker did score the other organization's chunk as relevant
    assert a2.strategy == FUSED and len(p2.calls) == 1 and "outside the corpus (Harvard University)" in a2.reason
    user = p2.calls[0][1]
    assert BIDS.chunk_id not in user and PENALTY.chunk_id in user  # mixed: the supported intent keeps its evidence
    assert question_of(user).endswith(Q_HARVARD)
    assert a2.status == "answered" and a2.intents[0]["status"] == "answered"
    assert all(c.chunk_id != BIDS.chunk_id for c in a2.citations) and all(1 not in cl["intents"] for cl in a2.claims)
    assert all(x["intent"] != 1 for xs in a2.evidence_intents.values() for x in xs)
    assert a2.not_in_sources and "Harvard" in a2.text  # the model's own gap statement, verified text only


def test_boundary_no_fabricated_answer_for_the_out_of_corpus_organization():
    st = stack(*ORG_STACK)
    a = MultiIntentController(st, StubProvider(org_script(fabricate=True)), ALIASES).run(Q_HARVARD)
    assert a.strategy == FUSED and a.status == "abstained" and a.abstention_reason == "ungrounded_output"
    assert any("quote not found" in p for p in a.verification_problems)  # the bid rule is not in any shown source
    assert "Harvard" not in a.text and a.claims == []


def test_boundary_every_intent_outside_the_corpus_abstains_without_a_model_call():
    st = stack(*ORG_STACK)
    q = "What purchase amount requires competitive bids at Harvard University, and what does Boston College pay for tips?"
    stub = StubProvider(org_script())
    a = MultiIntentController(st, stub, ALIASES).run(q)
    assert a.strategy == "no_supported_intent" and stub.calls == []
    assert a.status == "abstained" and a.abstention_reason == "unsupported_organization" and a.text == C.ABSTENTION_TEXT
    assert [i["outside_corpus"] for i in a.intents] == [["Harvard University"], ["Boston College"]]
    assert a.citations == [] and a.claims == []


def test_boundary_single_intent_question_is_phase_1_unchanged():
    st = stack(*ORG_STACK)
    q = "What purchase amount requires competitive bids at Harvard University?"
    a1, p1, a2, p2 = run_both(st, org_script(), q)
    assert not a2.decomposition["multi"] and a2.strategy == DELEGATE
    assert p2.calls == p1.calls and a2.phase1[0].to_dict() == a1.to_dict()  # the rule applies to phase 2 intents only
