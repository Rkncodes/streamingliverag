# Integration suite: automatic checks

Provider groq, model openai/gpt-oss-20b, prompt grounded-qa-1, settings {'temperature': 0.0, 'seed': 1234, 'reasoning_effort': 'medium', 'max_completion_tokens': 4096}. 27 cases × 2 runs. Automatic checks only (retrieval ranks, temporal selection, citations, status, regex fact checks). They are not a verdict on answer correctness; see report.md for the manual review.

Gold column: per evidence unit, hybrid rank → rank in the post-temporal rerank pool → rerank rank (✗ctx = not in context).

## Run 1: 20/27 passed all automatic checks

| case | expect | got | intent / selected | gold ranks | cited | primary failing stage | failures |
|---|---|---|---|---|---|---|---|
| i-uc-jul-submit | answer | answer | point_in_time / jul | 1→1→1 | 2026-07-01-tra…bc7d99 |  |  |
| i-uc-feb-suspend | answer | answer | point_in_time / feb | 2→1→1 | travel-and-ent…113880 |  |  |
| i-uc-jul-owner | answer | answer | point_in_time / jul | 1→1→1 | 2026-07-01-tra…ad0b00 |  |  |
| i-uc-cur-reinstate | answer | answer | current / jul | 1→1→1 | 2026-07-01-tra…bc7d99 |  |  |
| i-uc-cur-multibed | answer | answer | current / jul | 1→1→1 | 2026-07-01-tra…230e93 | generation | generation: explicit answer check: missing ['personal credit card'] / misstatement [] |
| i-uc-cmp-card | answer | answer | compare / jul,feb | 5→5→4; 4→4→5 | travel-and-ent…113880, 2026-07-01-tra…bc7d99 |  |  |
| i-uc-neutral-card | answer | answer | neutral / — | 2→2→2; 1→1→1 | 2026-07-01-tra…bc7d99, travel-and-ent…113880 |  |  |
| i-uc-cmp-lodging | answer | abstain (model_insufficient_evidence) | compare / jul,feb | 3→3→3 | — | generation | generation: abstained (model_insufficient_evidence): The provided sources do not contain the multi‑bedroom accommodation rules for the February 1, 2026 procedures, so a comparison cannot be made. |
| i-uc-march-tickets | abstain | abstain (model_insufficient_evidence) | point_in_time / feb | 6→4→8✗ctx | — |  |  |
| i-uc-feb-reinstate | abstain | abstain (model_insufficient_evidence) | point_in_time / feb | 4→2→1 | — |  |  |
| i-uc-unavailable | abstain | abstain (model_insufficient_evidence) | point_in_time / none | — | — |  |  |
| i-uc-neu-sio | answer | abstain (ungrounded_output) | neutral / — | 3→3→1 | — | verification | verification: abstained (ungrounded_output): claim 1: quote not found in cited source(s): 'Senior Institutional Official approval is required if: • The trip duration excee' |
| i-uc-spouse | answer | answer | neutral / — | 1→1→1; 2→2→2 | travel-and-ent…986e06, 2026-07-01-tra…f439d4 |  |  |
| i-uc-personal-leg | answer | answer | neutral / — | 2→2→2 | 2026-07-01-tra…b78821, travel-and-ent…6d97bd |  |  |
| i-ru-tips | answer | answer | neutral / — | 1→1→1 | chapter-11-uni…a70791 |  |  |
| i-ru-advance | answer | answer | neutral / — | 1→1→3 | chapter-11-uni…a77ccd |  |  |
| i-or-180k | answer | abstain (ungrounded_output) | neutral / — | 2→2→1; 3→3→6 | — | verification | verification: abstained (ungrounded_output): claim 1: number(s) ['180000'] not in cited source(s) |
| i-st-invoice | answer | answer | neutral / — | 1→1→1 | 5-1-1-procurem…ca9cba |  |  |
| i-pe-exception | answer | abstain (ungrounded_output) | neutral / — | 1→1→1 | — | verification | verification: abstained (ungrounded_output): claim 1: number(s) ['75000'] not in cited source(s) |
| i-ut-clause | answer | answer | neutral / — | 1→1→2 | information-re…23d33a |  |  |
| i-mi-mileage | answer | abstain (provider_error) | point_in_time / jul | 1→1→1 | — | provider | provider: RateLimitError: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-20b` in organization `org_01knsvdyyffwbsgj2w7yjrh79r` service tier `on_demand` on tokens per minut |
| i-ro-highrisk | answer | abstain (ungrounded_output) | neutral / — | 1→1→1 | — | verification | verification: abstained (ungrounded_output): claim 1: quote not found in cited source(s): 'All high‑risk travel requests should be submitted as far in advance as possible ' |
| i-ya-internet | abstain | abstain (model_insufficient_evidence) | neutral / — | — | — |  |  |
| i-st-mileage | abstain | abstain (model_insufficient_evidence) | neutral / — | — | — |  |  |
| i-harvard-bids | abstain | abstain (model_insufficient_evidence) | neutral / — | — | — |  |  |
| i-ro-tips | abstain | abstain (model_insufficient_evidence) | neutral / — | — | — |  |  |
| i-uc-nyc-hotel | abstain | abstain (low_relevance) | neutral / — | 6→6→6 | — |  |  |

LLM calls: 26 (errors: 1); tokens: prompt 49434, completion 11244, total 60678; end-to-end latency excl. pacing: total 396.0 s.

## Run 2: 19/27 passed all automatic checks

| case | expect | got | intent / selected | gold ranks | cited | primary failing stage | failures |
|---|---|---|---|---|---|---|---|
| i-uc-jul-submit | answer | answer | point_in_time / jul | 1→1→1 | 2026-07-01-tra…bc7d99 |  |  |
| i-uc-feb-suspend | answer | answer | point_in_time / feb | 2→1→1 | travel-and-ent…113880 |  |  |
| i-uc-jul-owner | answer | answer | point_in_time / jul | 1→1→1 | 2026-07-01-tra…ad0b00 |  |  |
| i-uc-cur-reinstate | answer | answer | current / jul | 1→1→1 | 2026-07-01-tra…bc7d99 |  |  |
| i-uc-cur-multibed | answer | abstain (provider_error) | current / jul | 1→1→1 | — | provider | provider: RateLimitError: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-20b` in organization `org_01knsvdyyffwbsgj2w7yjrh79r` service tier `on_demand` on tokens per minut |
| i-uc-cmp-card | answer | answer | compare / jul,feb | 5→5→4; 4→4→5 | travel-and-ent…113880, 2026-07-01-tra…bc7d99 |  |  |
| i-uc-neutral-card | answer | answer | neutral / — | 2→2→2; 1→1→1 | 2026-07-01-tra…bc7d99, travel-and-ent…113880 |  |  |
| i-uc-cmp-lodging | answer | abstain (model_insufficient_evidence) | compare / jul,feb | 3→3→3 | — | generation | generation: abstained (model_insufficient_evidence): The provided sources do not contain the multi‑bedroom accommodation rules for the February 1, 2026 procedures. |
| i-uc-march-tickets | abstain | abstain (model_insufficient_evidence) | point_in_time / feb | 6→4→8✗ctx | — |  |  |
| i-uc-feb-reinstate | abstain | abstain (model_insufficient_evidence) | point_in_time / feb | 4→2→1 | — |  |  |
| i-uc-unavailable | abstain | abstain (model_insufficient_evidence) | point_in_time / none | — | — |  |  |
| i-uc-neu-sio | answer | abstain (ungrounded_output) | neutral / — | 3→3→1 | — | verification | verification: abstained (ungrounded_output): claim 1: quote not found in cited source(s): 'Senior Institutional Official approval is required if: The trip duration exceeds' |
| i-uc-spouse | answer | abstain (ungrounded_output) | neutral / — | 1→1→1; 2→2→2 | — | verification | verification: abstained (ungrounded_output): claim 1: quote not found in cited source(s): 'The accompanying individual must have a defined, documented, and pre‑approved of'; claim 1: quote not found in cited source(s): 'The traveler must submit  |
| i-uc-personal-leg | answer | abstain (ungrounded_output) | neutral / — | 2→2→2 | — | verification | verification: abstained (ungrounded_output): claim 2: quote not found in cited source(s): 'A cost comparison must be provided at the time of booking for the business-only ' |
| i-ru-tips | answer | answer | neutral / — | 1→1→1 | chapter-11-uni…a70791 |  |  |
| i-ru-advance | answer | answer | neutral / — | 1→1→3 | chapter-11-uni…a77ccd |  |  |
| i-or-180k | answer | abstain (ungrounded_output) | neutral / — | 2→2→1; 3→3→6 | — | verification | verification: abstained (ungrounded_output): claim 1: number(s) ['180000'] not in cited source(s) |
| i-st-invoice | answer | answer | neutral / — | 1→1→1 | 5-1-1-procurem…ca9cba | generation | generation: explicit answer check: missing ['standard purchase order'] / misstatement [] |
| i-pe-exception | answer | abstain (ungrounded_output) | neutral / — | 1→1→1 | — | verification | verification: abstained (ungrounded_output): claim 1: number(s) ['75000'] not in cited source(s) |
| i-ut-clause | answer | answer | neutral / — | 1→1→2 | information-re…23d33a |  |  |
| i-mi-mileage | answer | answer | point_in_time / jul | 1→1→1 | travel-booking…a8d2df |  |  |
| i-ro-highrisk | answer | answer | neutral / — | 1→1→1 | international-…6f9066 |  |  |
| i-ya-internet | abstain | abstain (model_insufficient_evidence) | neutral / — | — | — |  |  |
| i-st-mileage | abstain | abstain (model_insufficient_evidence) | neutral / — | — | — |  |  |
| i-harvard-bids | abstain | abstain (model_insufficient_evidence) | neutral / — | — | — |  |  |
| i-ro-tips | abstain | abstain (model_insufficient_evidence) | neutral / — | — | — |  |  |
| i-uc-nyc-hotel | abstain | abstain (low_relevance) | neutral / — | 6→6→6 | — |  |  |

LLM calls: 26 (errors: 1); tokens: prompt 49076, completion 10801, total 59877; end-to-end latency excl. pacing: total 415.9 s.

## Run-to-run agreement

same_retrieval: 27/27 · same_temporal: 27/27 · same_rerank: 27/27 · same_context: 27/27 · same_status: 22/27 · same_abstention_reason: 22/27 · same_citations: 22/27 · same_explicit_check: 25/27 · identical_text: 18/27

