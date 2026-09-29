"""Multi-intent decomposition (AdaptiveRAG phase 2): deterministic pattern matching, no model.

  d = decompose(question, organizations)     # Decomposition(intents=[Intent, ...], multi, reason, flags)

A question has several intents when it asks two or three separate questions:
  * two question sentences                    "What is X? When does Y apply?"
  * coordinated interrogative clauses         "What is X, and what happens if Y?"   "... and when is Z?"
                                              "What is X; how is Y?"   serial: "What is X, how is Y, and when is Z?"
Never split:
  * temporal compare questions (two or more dates; temporal.intent "compare"): versions are the concern of
    temporal resolution and phase 1
  * sentences that are not questions ("Explain why." belongs to the question before it); non-question
    sentences before the first question are context shared by every intent
  * "and" between noun phrases or amounts: the word after "and" must start a question
  * clauses shorter than MIN_CLAUSE_WORDS words ("..., and when?")
  * clauses that refer back to the previous one ("..., and how often is that?"): not an independent need
  * more than MAX_INTENTS clauses (the question goes to phase 1 unchanged)

Each intent gets a retrieval query built only from the user's words: the context sentences, the sentence's
leading scope ("Under UConn's July 1, 2026 procedures,", "At Penn,") and the clause. A clause that names no
organization, while the other clauses name exactly one, gets that organization's full name in parentheses
(short names: config/organization_aliases.toml). Sub-queries drive retrieval only; the fused path shows the
model the original question.

Organization boundary: an intent whose own words name an institution ("Harvard University", "University of
Chicago", "Boston College") that is not an organization of the corpus, and name no corpus organization, records
that name in `outside_corpus`. The controller treats such an intent as unsupported: no other organization's
evidence may stand in for it, however high the reranker scores it. Only institution-style names are recognized
(... University / College / Institute, University / College / Institute of ...); a bare name outside the alias list
("Harvard") is not.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import asdict, dataclass, field
from pathlib import Path

from temporal.intent import parse_query

ALIASES_PATH = Path(__file__).resolve().parents[2] / "config" / "organization_aliases.toml"
MAX_INTENTS = 3  # the context holds MAX_SOURCES = 6 sources: a fourth intent would get about one
MIN_CLAUSE_WORDS = 3

_WH = r"(?:what|when|how|who|whom|whose|which|where|why|whether)"
_AUX = r"(?:is|are|was|were|does|do|did|can|could|must|should|will|would|may|has|have)"
# split points inside one question sentence; the lookahead keeps the interrogative word in the new clause
_CUTS = [re.compile(rf"\s*[,;]?\s+and\s+(?={_WH}\b)", re.I),  # "X, and what ..." / "X and when ..."
         re.compile(rf",\s+and\s+(?={_AUX}\b)", re.I),  # "X, and is ..." (an auxiliary needs the comma)
         re.compile(rf";\s+(?={_WH}\b|{_AUX}\b)", re.I)]  # "X; how ..."
_SERIAL = re.compile(rf",\s+(?={_WH}\b)", re.I)  # "X, how Y, and when Z": only when the list ends with ", and <wh>"
_SERIAL_END = re.compile(rf",\s+and\s+{_WH}\b", re.I)
_WH_WORD = re.compile(rf"\b{_WH}\b", re.I)
_LEADING_AUX = re.compile(rf"^\s*{_AUX}\b", re.I)
_SENTENCE = re.compile(r"(?<=\?)\s+|(?<=[a-z0-9)%]\.)\s+(?=[A-Z])")
_COMMA = re.compile(r",\s+")
# a later clause that refers back ("how often is that?", "what does that method involve?") is not independent
_REFERS_BACK = re.compile(r"\b(?:it|its|they|them|their|this|that|these|those|such)\b", re.I)
# an organization the alias list does not know ("at Harvard University", "Harvard's"): never overwrite it
_OTHER_ORG = re.compile(r"\b(?:at|of|from|by)\s+(?:the\s+)?[A-Z][\w&.'’-]*|\b[A-Z][a-z]+['’]s\b")
# an institution-style name: "Harvard University", "Boston College", "University of Chicago"
_NAME = r"[A-Z][\w&.'’-]*"
_INSTITUTION = re.compile(rf"\b(?:{_NAME}\s+)+(?:University|College|Institute)\b"
                          rf"|\b(?:University|College|Institute) of (?:the )?{_NAME}(?:\s+(?:at\s+)?{_NAME})*")
# capitalized words that start a sentence or clause, not a name ("Which University Travel Card ...")
_NOT_A_NAME = {"What", "When", "How", "Who", "Whom", "Whose", "Which", "Where", "Why", "Whether", "Is", "Are", "Was",
               "Were", "Does", "Do", "Did", "Can", "Could", "Must", "Should", "Will", "Would", "May", "Has", "Have",
               "The", "A", "An", "At", "Under", "According", "For", "In", "On", "Of", "From", "By", "If", "And", "Or"}


@dataclass
class Intent:
    index: int
    text: str  # the clause as the user wrote it
    sub_query: str  # what retrieval sees for this intent
    organizations: list[str] = field(default_factory=list)  # organizations the intent's own words name
    carried: list[str] = field(default_factory=list)  # organizations added from the other clauses
    outside_corpus: list[str] = field(default_factory=list)  # institutions it names that the corpus does not hold


@dataclass
class Decomposition:
    question: str
    intents: list[Intent]
    multi: bool
    reason: str
    flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def load_aliases(path: Path = ALIASES_PATH) -> dict[str, str]:
    with open(path, "rb") as f:
        return dict(tomllib.load(f)["aliases"])


def _is_question(text: str) -> bool:
    return bool(_WH_WORD.search(text) or _LEADING_AUX.match(text))


def _words(text: str) -> int:
    return len(text.split())


def _clauses(sentence: str) -> list[str]:
    """One question sentence -> its interrogative clauses (without the final "?")."""
    body = sentence.rstrip().rstrip("?").rstrip()
    cuts = [m for rx in _CUTS for m in rx.finditer(body)]
    if _SERIAL_END.search(body):
        cuts += list(_SERIAL.finditer(body))
    cuts.sort(key=lambda m: m.start())
    pieces, last = [], 0
    for i, m in enumerate(cuts):
        if m.start() < last:  # overlapping candidates
            continue
        before = body[last:m.start()]
        after = body[m.end():cuts[i + 1].start() if i + 1 < len(cuts) else len(body)]
        if (_is_question(before) and _words(before) >= MIN_CLAUSE_WORDS and _words(after) >= MIN_CLAUSE_WORDS
                and not _REFERS_BACK.search(after)):
            pieces.append(before.strip())
            last = m.end()
    pieces.append(body[last:].strip())
    return pieces


def _scope(piece: str) -> tuple[str, str]:
    """Leading comma-terminated phrase without an interrogative ("At Penn, ", "Under ... 2026, ") and the rest."""
    scope = ""
    for m in _COMMA.finditer(piece):
        prefix = piece[:m.end()]
        if _is_question(prefix):
            break
        scope = prefix
    return scope, piece[len(scope):]


def mentions(text: str, organizations: set[str], aliases: dict[str, str]) -> list[str]:
    """Organizations named in `text` (full names case-insensitively, short names exactly), in first-seen order."""
    found: list[tuple[int, str]] = []
    for org in organizations:
        m = re.search(rf"(?<!\w){re.escape(org)}(?!\w)", text, re.I)
        if m:
            found.append((m.start(), org))
    for alias, org in aliases.items():
        m = re.search(rf"(?<!\w){re.escape(alias)}(?:['’]s)?(?!\w)", text)
        if m:
            found.append((m.start(), org))
    return list(dict.fromkeys(org for _, org in sorted(found)))


def outside_corpus(text: str, organizations: set[str], aliases: dict[str, str]) -> list[str]:
    """Institution-style names in `text` that are not a corpus organization (nor contain or are contained in one,
    or an alias: "UConn University", "the University of Texas at Austin" are known)."""
    known = [x.lower() for x in (*organizations, *aliases)]
    out = []
    for m in _INSTITUTION.finditer(text):
        words = m.group(0).split()
        while words and words[0] in _NOT_A_NAME:
            words.pop(0)
        name = " ".join(words)
        if len(words) < 2 or any(k in name.lower() or name.lower() in k for k in known):
            continue
        out.append(name)
    return list(dict.fromkeys(out))


def decompose(question: str, organizations: set[str] | None = None, aliases: dict[str, str] | None = None
              ) -> Decomposition:
    aliases = load_aliases() if aliases is None else aliases
    organizations = set(aliases.values()) if organizations is None else set(organizations)
    q = " ".join(question.split())

    def single(reason: str, flags: list[str] | None = None) -> Decomposition:
        return Decomposition(question, [Intent(0, q, question, mentions(q, organizations, aliases))], False, reason,
                             flags or [])

    if parse_query(q).kind == "compare":
        return single("temporal compare question (versions are handled by temporal resolution and phase 1)")
    sentences = [s.strip() for s in _SENTENCE.split(q) if s.strip()]
    asks = [i for i, s in enumerate(sentences) if s.endswith("?")]
    if not asks:
        return single("no question sentence")
    context = " ".join(sentences[:asks[0]])
    clauses: list[tuple[str, str]] = []  # (scope, clause)
    for i in asks:
        pieces = _clauses(sentences[i])
        if clauses and (_words(pieces[0]) < MIN_CLAUSE_WORDS or _REFERS_BACK.search(pieces[0])):
            scope, text = clauses[-1]  # "...? Why?" / "...? When does it apply?": part of the previous intent
            clauses[-1] = (scope, f"{text}? {sentences[i].rstrip('?')}")
            continue
        scope, first = _scope(pieces[0])
        clauses += [(scope, first)] + [(scope, p) for p in pieces[1:]]
    if len(clauses) < 2:
        return single("one question")
    if len(clauses) > MAX_INTENTS:
        return single(f"{len(clauses)} question clauses (more than MAX_INTENTS = {MAX_INTENTS})", ["too_many_intents"])

    bases = [" ".join(x for x in (context, f"{scope}{text}?") if x) for scope, text in clauses]
    own = [mentions(b, organizations, aliases) for b in bases]
    intents, flags = [], []
    for k, ((scope, text), base) in enumerate(zip(clauses, bases)):
        carried: list[str] = []
        outside = [] if own[k] else outside_corpus(base, organizations, aliases)
        if not own[k] and not outside and not _OTHER_ORG.search(f"{scope}{text}"):
            others = list(dict.fromkeys(o for j, orgs in enumerate(own) if j != k for o in orgs))
            if len(others) == 1:
                carried = others
            elif others:
                flags.append(f"ambiguous_organization:intent_{k}")
        sub = base + (f" ({'; '.join(carried)})" if carried else "")
        intents.append(Intent(k, f"{text}?", sub, own[k], carried, outside))
    return Decomposition(question, intents, True, f"{len(intents)} question clauses", flags)
