"""Multi-intent decomposition (offline, deterministic): what is split, what is not, sub-queries, organizations."""

import pytest

from adaptive.multi.decompose import MAX_INTENTS, decompose, load_aliases
from temporal.intent import parse_query

ALIASES = load_aliases()
ORGS = set(ALIASES.values()) | {"University of Michigan", "University of Rochester", "McGill University"}
UCONN = "University of Connecticut"


def d(q):
    return decompose(q, ORGS, ALIASES)


# ---------------------------------------------------------------- not split


@pytest.mark.parametrize("q", [
    "How often must UT Austin user accounts be reviewed?",
    # a trailing non-question sentence belongs to the question
    "At Stanford, can a $240 invoice overage on a $2,000 standard purchase order be paid without a written change "
    "order? Explain why.",
    # no question sentence
    "Compare the February 1, 2026 and July 1, 2026 UConn Travel Card penalty rules.",
    # temporal compare: versions are phase 1's concern
    "What did UConn's travel procedures effective February 1, 2026 and those effective July 1, 2026 each say about "
    "when a University Travel Card is suspended?",
    # "and" between noun phrases / amounts
    "Is there a limit on the tips and gratuities Rutgers will reimburse?",
    "Are Penn purchases of $50,000 or more subject to review and approval before issuance?",
    # an auxiliary after "and" needs a comma
    "What happens to charges that are submitted and are approved after the deadline?",
    # too short to be a question of its own
    "What must a UConn traveler submit, and when?",
    "What must a UConn traveler submit? Why?",
    # refers back to the previous clause: not independent
    "Which clause of UT Austin's information resources policy sets how often user accounts must be reviewed, and how "
    "often is that?",
    "Oregon State expects a contract price of $180,000. Which general procurement method applies, and what does that "
    "method involve?",
    "What is Rutgers' tip limit? When does it apply?",
])
def test_single_intent_questions_are_not_split(q):
    r = d(q)
    assert not r.multi and len(r.intents) == 1
    assert r.intents[0].sub_query == q  # the question itself, untouched


def test_compare_reason_is_recorded():
    r = d("Compare the multi-bedroom accommodation rules in UConn's procedures effective February 1, 2026 and July 1, 2026?")
    assert not r.multi and "compare" in r.reason


# ---------------------------------------------------------------- split


def test_the_phase_2_example_is_split_and_the_organization_carried():
    r = d("What is the UConn University Travel Card submission deadline, and what happens if charges aren't submitted "
          "on time?")
    assert r.multi and [i.text for i in r.intents] == [
        "What is the UConn University Travel Card submission deadline?",
        "what happens if charges aren't submitted on time?"]
    assert r.intents[0].organizations == [UCONN] and r.intents[0].carried == []
    assert r.intents[1].organizations == [] and r.intents[1].carried == [UCONN]
    assert r.intents[1].sub_query == f"what happens if charges aren't submitted on time? ({UCONN})"


def test_leading_scope_applies_to_every_clause_and_keeps_the_version():
    r = d("Under UConn's travel procedures effective July 1, 2026, within how many days must University Travel Card "
          "charges be submitted, and when is the card suspended?")
    assert r.multi and len(r.intents) == 2
    scope = "Under UConn's travel procedures effective July 1, 2026, "
    assert all(i.sub_query.startswith(scope) for i in r.intents)
    kinds = [parse_query(i.sub_query) for i in r.intents]
    assert [k.kind for k in kinds] == ["point_in_time", "point_in_time"] and kinds[0].dates == kinds[1].dates
    assert r.intents[1].carried == []  # the scope names UConn


def test_context_sentence_is_shared():
    ctx = "A University of Rochester researcher plans travel to a high-risk location."
    r = d(f"{ctx} How far ahead should the travel request be submitted, and who must approve the trip?")
    assert r.multi and all(i.sub_query.startswith(ctx + " ") for i in r.intents)


def test_two_question_sentences():
    r = d("What airfare does the University of Michigan pay for? How far in advance should a University of Michigan "
          "traveler book airfare?")
    assert r.multi and len(r.intents) == 2 and r.intents[1].text.startswith("How far in advance")


def test_serial_list_of_three_questions_across_organizations():
    r = d("How often must UT Austin user accounts be reviewed, what mileage rate does the University of Michigan "
          "reimburse, and how far in advance must a Rutgers travel advance request be submitted?")
    assert r.multi and len(r.intents) == 3
    assert [i.organizations for i in r.intents] == [["The University of Texas at Austin"], ["University of Michigan"],
                                                    ["Rutgers University"]]
    assert all(i.carried == [] for i in r.intents)


def test_an_auxiliary_clause_after_comma_and():
    r = d("What did UConn's February 2026 procedures say about when a University Travel Card is suspended, and may a "
          "traveler currently pay for a multi-bedroom accommodation with a University Travel Card?")
    assert r.multi and r.intents[1].text.startswith("may a traveler currently")
    assert parse_query(r.intents[0].sub_query).kind == "point_in_time"
    assert parse_query(r.intents[1].sub_query).kind == "current"  # each intent keeps its own temporal words


def test_more_than_max_intents_goes_to_phase_1():
    q = ("What does Rutgers reimburse for tips, what does Stanford require for invoices, how often must UT Austin "
         "accounts be reviewed, and what airfare does the University of Michigan pay for?")
    r = d(q)
    assert MAX_INTENTS == 3 and not r.multi and r.flags == ["too_many_intents"] and r.intents[0].sub_query == q


def test_ambiguous_organization_is_not_carried():
    r = d("What does Rutgers reimburse for tips, what does Stanford require for invoices, and how are travel advances "
          "requested?")
    assert r.multi and r.intents[2].carried == [] and r.flags == ["ambiguous_organization:intent_2"]


def test_an_organization_outside_the_alias_list_is_not_overwritten():
    r = d("How far ahead should a University of Rochester traveler submit a request for travel to a high-risk location, "
          "and what purchase amount requires competitive bids at Harvard University?")
    assert r.multi and r.intents[1].organizations == [] and r.intents[1].carried == []


def test_deterministic():
    q = "At Penn, what happens to purchase orders of $50,000 or more before issuance, and when are competitive bids not required?"
    assert d(q).to_dict() == d(q).to_dict()
    r = d(q)
    assert r.multi and all(i.sub_query.startswith("At Penn, ") for i in r.intents)


# ---------------------------------------------------------------- the existing integration questions


def test_integration_questions_decomposition():
    """Only two of the 27 frozen integration questions have two independent clauses; everything else is single."""
    from evaluation.integration.cases import CASES

    multi = {c["id"] for c in CASES if d(c["question"]).multi}
    assert multi == {"i-uc-jul-submit", "i-uc-personal-leg"}


def test_phase_2_cases_decompose_as_declared():
    from evaluation.multi_intent.cases import CASES as MI_CASES

    for c in MI_CASES:
        r = d(c["question"])
        assert r.multi == c["multi"], c["id"]
        if c["multi"]:
            assert len(r.intents) == len(c["intents"]), c["id"]


def test_phase_2_case_gold_resolves_to_one_chunk_each():
    from chunking.pipeline import load_chunks
    from evaluation.integration.cases import resolve
    from evaluation.multi_intent.cases import CASES as MI_CASES

    try:
        cbd = load_chunks()
    except FileNotFoundError:
        pytest.skip("chunks not generated")
    ids = [c["id"] for c in MI_CASES]
    assert len(ids) == len(set(ids))
    for c in MI_CASES:
        for p in c["intents"]:
            for unit in p["gold"]:
                assert unit and all(resolve(r, cbd) for r in unit), c["id"]  # raises unless exactly one chunk


# ---------------------------------------------------------------- aliases


def test_aliases_name_corpus_organizations_and_are_all_used():
    from chunking.pipeline import load_chunks
    from evaluation.integration.cases import CASES
    from evaluation.multi_intent.cases import CASES as MI_CASES

    try:
        chunks = [c for cs in load_chunks().values() for c in cs]
    except FileNotFoundError:
        pytest.skip("chunks not generated")
    if not chunks:
        pytest.skip("chunks not generated")
    corpus_orgs = {c.organization for c in chunks}
    assert set(ALIASES.values()) <= corpus_orgs
    questions = [c["question"] for c in CASES] + [c["question"] for c in MI_CASES]
    for alias in ALIASES:
        assert any(alias in q for q in questions), f"alias {alias!r} is not needed by any case"


# ---------------------------------------------------------------- organization boundary


@pytest.mark.parametrize("text, outside", [
    ("what purchase amount requires competitive bids at Harvard University?", ["Harvard University"]),
    ("Which University Travel Card rules apply at the University of Chicago?", ["University of Chicago"]),
    ("Does Boston College pay for tips?", ["Boston College"]),
    ("What is the UConn University Travel Card submission deadline?", []),  # "UConn University": an alias
    ("How often must The University of Texas at Austin review accounts?", []),
    ("What does the University of Rochester say about tips?", []),
    ("What is the threshold at Oregon State University?", []),
    ("Which University Travel Card charges are late?", []),  # "Which" is not a name
    ("Who approves travel for a Senior Institutional Official?", []),
])
def test_outside_corpus_names(text, outside):
    from adaptive.multi.decompose import outside_corpus

    assert outside_corpus(text, ORGS, ALIASES) == outside


def test_an_out_of_corpus_intent_is_recorded_and_gets_no_carried_organization():
    r = d("How far ahead should a University of Rochester traveler submit a request for travel to a high-risk location, "
          "and what purchase amount requires competitive bids at Harvard University?")
    assert r.multi and r.intents[1].outside_corpus == ["Harvard University"] and r.intents[1].carried == []
    assert r.intents[0].outside_corpus == []


def test_single_intent_questions_are_not_marked_outside_the_corpus():
    r = d("What purchase amount requires competitive bids at Harvard University?")
    assert not r.multi and r.intents[0].outside_corpus == []  # single intent: phase 1 decides, unchanged
