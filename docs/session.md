# AdaptiveRAG phase 3: session-aware refinement

A layer above the multi-intent controller (phase 2) that answers follow-up questions in a conversation. It rewrites a
follow-up into one standalone query and hands it to phase 2; nothing below changes (retrieval, temporal resolution,
the prompt, the verifier, phase 1, phase 2).

```
session = Session()
turn = SessionController(stack, provider).ask(session, question)     # appends a Turn to the session

question -> resolve against the previous turn (adaptive/session/resolve.py: rules, no model)
   self_contained -> MultiIntentController.run(question)            exactly phase 2
   follow_up      -> MultiIntentController.run(rewritten query)     phase 2, unchanged, on one standalone query
   unresolved     -> abstain: no retrieval, no model call
```

CLI: `python -m adaptive.session 'first question' 'follow-up' ...` (one conversation; `--json` for the session state).
Single-quote the questions: inside double quotes the shell turns `$180,000` into `,000`.

## Files

| file | role |
|---|---|
| `adaptive/session/state.py` | `Session` (the turns), `Turn` (question, resolution, phase 2 answer, reused citations), `Resolution` |
| `adaptive/session/resolve.py` | `resolve(question, last_turn, organizations, aliases)`: the rules below; `compose`, `strip_temporal` |
| `adaptive/session/controller.py` | `SessionController.ask(session, question)` |
| `evaluation/session/` | 8 conversations (`cases.py`) and the offline evaluation (`run.py`, `results/offline.*`) |
| `tests/test_session.py` | 15 offline tests |

## Resolution rules

* **self_contained**: the first turn, or a question that names its own organization (a corpus organization or
  alias, an institution outside the corpus, or an unknown `Name's` / `at Name`) and does not refer back.
* **follow_up**: a question that refers back (`Does that ...`, `Is it ...`, `this policy`, `the same rule`,
  `What about ...`, `What if ...`, `And ...`) or names no organization at all. It is rewritten as
  `(Earlier in this conversation: <earlier question(s)>[; version: <constraint>]). <follow-up>`.
  Phase 2 treats a non-question sentence before the question as context shared by every intent, so its
  decomposition (a follow-up may itself ask two things), coverage gate, retrieval and verification apply as for
  any question.
* **unresolved**: it depends on the conversation, but the previous turn asked several questions, or the topic
  names several organizations, or the question names a different organization than the topic
  (`Does Harvard University have the same rule?`), or the previous turn was unresolved. The turn abstains with
  `UNRESOLVED_TEXT` and the reason; nothing is retrieved and the model is not called.

**What a follow-up is read with**: the question that started the topic and, when the previous turn was a follow-up,
that question too (at most two earlier questions). Never the previous answer: answer text in the query would let
the verifier accept its numbers as the user's own (numbers named in the question need no source).

**Temporal constraint**: the earlier questions are shown without their dates or "current". The constraint in effect
is the follow-up's own when it names one (`currently`, `in February 2026`), else the inherited one, stated once as
`; version: ...`. Temporal resolution then selects versions from the rewritten query as for any question: after
"What did UConn's February 2026 procedures say ...?", "Does that still apply under the current procedures?" selects
the July 2026 version.

**Evidence provenance**: no evidence is carried between turns. Every answered turn retrieves, answers and verifies
its own evidence, and its citations are its own. `Turn.reused_citations` only reports which cited chunks the
anchor turn also cited (retrieved and verified again).

## Evaluation

`python -m evaluation.session.run`: the 8 conversations on the live corpus, real retrieval stack, stub model (no
tokens). Result (`evaluation/session/results/offline.md`): 17/17 turns pass the offline checks (resolution kind,
temporal intent and selected version, gold evidence shown to the model, no model call when unresolved, model input
byte-identical to phase 2 for self-contained turns). Gold evidence of the 6 follow-ups is shown to the model 6/6
with the session and 3/6 when phase 2 gets the follow-up alone (`s-direct`, `s-temporal`, `s-chain` turn 2 need the
session). Answer quality needs a live run (not done).

## Limitations

* Rules, not a model: references are recognized by the patterns above. A bare pronoun (`it`, `that`) in a question
  that names an organization is not a reference (relative "that" is too common), so
  `What does Harvard's policy say about it?` is processed as self-contained, exactly as phase 2 would.
* A bare organization name the lists do not know (`Harvard` without `University`, `'s` or a preposition) is not
  recognized, so such a follow-up is given the conversation's organization, as in phase 2.
* Switching organization with a reference (`Does Rutgers have the same rule?`) is not resolved; it abstains.
* A follow-up is read with at most two earlier questions; a reference to anything older is not resolved.
* A first question that refers back (`Does that apply?`) has nothing to resolve against and goes to phase 2 as is.
* The session lives in memory for one `Session` object; there is no persistence.
