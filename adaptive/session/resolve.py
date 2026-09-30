"""Follow-up resolution (AdaptiveRAG phase 3): deterministic pattern matching against the session, no model.

  resolution = resolve(question, session.last, organizations, aliases)

  self_contained  the first turn, or a question that names its own organization and does not refer back:
                  the question goes to the multi-intent controller verbatim (exactly phase 2)
  follow_up       a question that refers back ("Does that apply currently?", "this policy", "What about ...?")
                  or names no organization ("What documentation is required after the trip?"): it is rewritten
                  into one standalone query, a context sentence with the earlier question(s) and then the
                  question itself:
                    "(Earlier in this conversation: What is UConn's University Travel Card suspension rule).
                     Does that apply currently?"
                  Phase 2 treats a non-question sentence before the question as context shared by every intent,
                  so its decomposition, retrieval, temporal resolution and verification run unchanged on it.
  unresolved      the reference cannot be resolved safely: no retrieval, no model call, an explicit abstention
                  * the previous turn asked several questions (which one does "that" mean?)
                  * the topic names several organizations
                  * the question refers back but names another organization ("Does Rutgers have the same rule?")
                  * the previous turn was itself unresolved

What a follow-up is read with (Resolution.topic): the question that started the topic and, when the previous turn
was a follow-up, that question too; never the previous answer. Answer text in the query would let the verifier
accept its numbers as the user's own (numbers named in the question need no source), so earlier model output
never becomes evidence. The earlier questions are shown without their dates or "current": the temporal
constraint in effect is the follow-up's own when it names one ("currently", "in February 2026"), else the one
inherited from the topic, stated once ("; version: February 2026"). Temporal resolution then selects versions from the rewritten query as for
any question.
"""

from __future__ import annotations

import re

from adaptive.multi.decompose import mentions, outside_corpus
from temporal.intent import MONTHS, parse_query

from .state import FOLLOW_UP, SELF_CONTAINED, UNRESOLVED, Resolution, Turn

_AUX = r"(?:does|do|did|is|are|was|were|would|will|can|could|should|must|has|have)"
# a question opening on a reference to what came before: "Does that apply ...?", "And is it ...?"
_REF_OPENER = re.compile(rf"^\s*(?:(?:and|but|so)\s+)?{_AUX}\s+(?:that|this|it|these|those|they|the same)\b", re.I)
# a noun phrase pointing back: "this policy", "that rule", "the same limit"
_REF_PHRASE = re.compile(r"\b(?:that|this|these|those|the same|such an?|such)\s+(?:rules?|polic(?:y|ies)|procedures?|"
                         r"requirements?|limits?|deadlines?|documents?|versions?|provisions?|process|amount|answer|one)\b",
                         re.I)
# a question continuing the previous one: "What about ...?", "And when ...?", "What if ...?"
_CONTINUATION = re.compile(r"^\s*(?:and|also|so|then|what about|how about|same for|what if)\b", re.I)
# a name the organization lists do not know: "at Harvard", "Harvard's" (only when no known organization is named)
_NAMED = re.compile(r"\b(?:at|of|from|by)\s+(?:the\s+)?([A-Z][\w&.-]*)|\b([A-Z][a-z]+)['’]s\b")
_NOT_A_NAME = {"What", "Who", "How", "Where", "When", "Why", "Which", "That", "This", "It", "There", "Here", "The",
               "A", "An", "I"}
# a date is removed together with the word that introduces it ("effective July 1, 2026"); "current" alone
_LEAD = r"(?:\b(?:effective|as of|dated|on|in|from|since|under|for)\s+(?:the\s+)?)?"


def references(question: str) -> list[str]:
    """The words by which a question refers to the conversation (empty: it does not)."""
    return [m.group(0).strip() for rx in (_REF_OPENER, _REF_PHRASE, _CONTINUATION) for m in rx.finditer(question)]


def unknown_names(question: str, topic: str = "") -> list[str]:
    """Capitalized names after at/of/from/by, or possessives, that are neither months nor words of the topic."""
    known = set(re.findall(r"[\w&.-]+", topic))
    out = []
    for m in _NAMED.finditer(question):
        name = m.group(1) or m.group(2)
        if name.lower() in MONTHS or name in _NOT_A_NAME or name in known:
            continue
        out.append(name)
    return list(dict.fromkeys(out))


def strip_temporal(text: str) -> str:
    """`text` without its dates and "current"-type words, so that it selects no version by itself."""
    for _ in range(8):
        t = parse_query(text)
        if t.kind == "neutral":
            break
        for part in [_LEAD + re.escape(d.text) for d in t.dates] or [re.escape(t.trigger)]:
            text = re.sub(part, " ", text, count=1, flags=re.I)
    text = re.sub(r"\s+([,.;:?)])", r"\1", " ".join(text.split()))
    return re.sub(r",\s*,", ",", text).strip(" ,")


def compose(question: str, topic: list[str], temporal: str = "") -> str:
    """One standalone query: a context sentence (never a question sentence) with the earlier questions and the
    inherited temporal constraint, then the follow-up itself."""
    earlier = "; ".join(strip_temporal(t).rstrip(" ?.!").replace("?", ".") for t in topic)
    note = f"; version: {temporal}" if temporal else ""
    q = question.strip()
    return f"(Earlier in this conversation: {earlier}{note}). {q[:1].upper()}{q[1:]}"


def resolve(question: str, last: Turn | None, organizations: set[str], aliases: dict[str, str]) -> Resolution:
    q = " ".join(question.split())
    own = parse_query(q)
    own_temporal = own.trigger if own.kind != "neutral" else ""
    named = mentions(q, organizations, aliases)
    outside = outside_corpus(q, organizations, aliases)
    topic_text = " ".join(last.resolution.topic) if last else ""
    unknown = [] if named or outside else unknown_names(q, topic_text)
    names = list(dict.fromkeys(named + outside + unknown))
    refs = references(q)
    signals = {"references": refs, "organizations_named": named, "outside_corpus": outside, "unknown_names": unknown,
               "own_temporal": own.kind}

    if last is None or (names and not refs):
        reason = "first turn of the session" if last is None else "names its own organization and does not refer back"
        return Resolution(SELF_CONTAINED, reason, question, [question], own_temporal, names, None, signals)

    why = f"refers back ({', '.join(refs)})" if refs else "names no organization"

    def unresolved(reason: str) -> Resolution:
        return Resolution(UNRESOLVED, f"{why}, but {reason}", "", [], "", names, last.index, signals)

    if last.resolution.kind == UNRESOLVED:
        return unresolved("the previous turn could not be resolved either")
    if last.intents > 1:
        return unresolved(f"the previous turn asked {last.intents} questions, so the reference is ambiguous")
    topic_orgs = last.resolution.organizations
    if len(topic_orgs) > 1:
        return unresolved(f"the topic names several organizations ({', '.join(topic_orgs)})")
    if names and not set(names) <= set(topic_orgs):
        return unresolved(f"it names {', '.join(names)} while the topic is about "
                          f"{', '.join(topic_orgs) or 'no named organization'}")
    topic = ([last.resolution.topic[0]] if last.resolution.kind == FOLLOW_UP else []) + [last.question]
    inherited = last.resolution.temporal
    query = compose(q, topic, "" if own_temporal else inherited)
    return Resolution(FOLLOW_UP, why, query, topic, own_temporal or inherited, topic_orgs, last.index, signals)
