# AdaptiveRAG: version-aware RAG over university policy documents

AdaptiveRAG answers questions about institutional policy PDFs with cited, verifiable answers. It combines
hybrid retrieval (dense embeddings + BM25), resolution of which document version a question refers to,
cross-encoder reranking and grounded generation. Every quote the model gives is checked deterministically
against the source text before an answer is shown. When the evidence is missing, or the model's output cannot
be verified, the system abstains instead of guessing.

The corpus is 12 policy and procedure documents from 10 universities (procurement, travel and expenses, remote
work, information security). It includes two dated versions of the same UConn procedures (effective February 1
and July 1, 2026), which the version-resolution layer distinguishes.

Each layer was built and evaluated in turn. Every evaluation in this README has its script, cases and saved
results in [`evaluation/`](evaluation/).

---

## Highlights

- **Benchmarked retrieval.** 5 embedding models compared on a hand-built 69-query benchmark with frozen gold
  labels. Then BM25, dense and hybrid (Reciprocal Rank Fusion), then a cross-encoder reranker. Parameters were
  fixed from standard defaults before evaluation and not tuned on the benchmark.
- **Version-aware retrieval.** A deterministic layer detects whether a question names a date, asks for the
  current rule, compares versions, or is neutral. It then removes chunks from the wrong version of a document
  series, using only chunk metadata (`effective_date`, `superseded_date`, `is_current`).
- **Evidence-grounded generation.** The LLM answers as structured claims, each carrying verbatim quotes. Code
  checks that every quote occurs in a source the claim cites, that numbers appear in the cited text, and that
  claims do not merge document versions or organizations. Output that fails these checks becomes an abstention.
- **Adaptive orchestration.** Deterministic, rule-based controllers sit above the frozen core. They split
  answers by version when the verifier rejects a merged answer, decompose multi-part questions, resolve
  follow-up questions within a session, and run a bounded loop of up to 3 retrieval rounds. None of these
  controllers calls the model to make decisions.
- **Distributed services.** FastAPI services for the API, retrieval and generation, plus a RabbitMQ-driven
  orchestrator worker. Redis stores sessions, and an MCP server exposes the tools. An optional PostgreSQL
  database holds a copy of the metadata, and optional OpenTelemetry tracing records spans across the services.
- **React inspection UI.** A Vite + React + TypeScript workspace for asking questions. It shows the citations,
  evidence, retrieval trace and session state that the backend returns.
- **Tested.** An offline pytest suite (844 passing tests at the time of writing) and Vitest tests for the
  frontend model layer.

---

## Architecture

### Services

```mermaid
flowchart LR
    UI["React frontend<br/>Vite dev server :5180"] -->|"/svc/api proxy"| API
    CLI["HTTP client"] -->|"POST /query"| API["api<br/>FastAPI :8000"]

    API -->|"JobRequest"| JOBS[("RabbitMQ<br/>adaptiverag.jobs")]
    JOBS --> ORCH["orchestrator worker<br/>session → multi-intent → adaptive controller"]
    ORCH -->|"JobEvent"| EVENTS[("RabbitMQ<br/>adaptiverag.job_events")]
    EVENTS --> API

    ORCH <-->|"load / store session"| REDIS[("Redis<br/>session store")]
    API -->|"read answered turn"| REDIS

    ORCH -->|"POST /retrieve"| RET["retrieval<br/>FastAPI :8001"]
    ORCH -->|"POST /generate"| GEN["generation<br/>FastAPI :8002"]
    RET --> DATA[("data/<br/>chunks + arctic-m index")]
    GEN --> LLM["Groq LLM<br/>or offline stub"]

    MCP["MCP server<br/>:8003/mcp"] -->|"POST /retrieve"| RET
    MCP --> DATA
    MCP -.->|"database_query (optional)"| PG[("PostgreSQL<br/>metadata copy")]
```

| Service | Module | Responsibility |
|---|---|---|
| api | [`services/api/`](services/api/) | Public HTTP interface and request validation. Submits a job and waits for its result. |
| orchestrator | [`services/orchestrator/`](services/orchestrator/) | Consumes jobs, runs the session / multi-intent / adaptive controllers, loads and stores sessions. Holds no index and calls no model. |
| retrieval | [`services/retrieval/`](services/retrieval/) | Loads the retrieval stack (dense, BM25, RRF, temporal resolution, cross-encoder) and runs single or iterative retrieval. |
| generation | [`services/generation/`](services/generation/) | Owns the model provider and its credentials. Runs the grounded answerer (gate → context → LLM → verifier). |
| mcp | [`services/mcp/`](services/mcp/) | Model Context Protocol server with three read-only tools: `document_search`, `metadata_lookup`, `database_query`. |

`services/inprocess.py` wires the four core services into one process with an in-memory broker. The tests and
offline evaluations use it, so they need no infrastructure.

OpenTelemetry tracing ([`services/telemetry/`](services/telemetry/)) is off by default. When enabled, it creates
spans for HTTP requests, `orchestrator.execute`, `retrieval.execute` / `retrieval.round`, `generation.execute`,
MCP tool calls and database queries. It never records question text, answers, prompts or document text. Trace
context does not cross RabbitMQ: when the services run as separate processes, the API and orchestrator spans are
linked by a shared `correlation_id`.

### Query pipeline

```mermaid
flowchart TD
    subgraph offline["Offline build"]
        PDF["corpus/*.pdf<br/>12 documents"] --> ING["ingestion<br/>PyMuPDF extraction, cleaning,<br/>structure, metadata"]
        ING --> CHK["chunking<br/>section-aware chunks,<br/>clause numbering"]
        CHK --> IDX["indexes<br/>arctic-m embeddings + BM25"]
    end

    subgraph online["Per question"]
        Q["question"] --> HYB["hybrid retrieval<br/>dense + BM25, fused with RRF"]
        HYB --> TMP["temporal resolution<br/>drop wrong-version chunks"]
        TMP --> RR["cross-encoder rerank<br/>top-20 pool → top 10"]
        RR --> GATE{"evidence gate"}
        GATE -->|"low relevance"| ABS["abstain<br/>no LLM call"]
        GATE --> CTX["context assembly<br/>up to 6 sources"]
        CTX --> GENR["LLM: JSON claims<br/>with verbatim quotes"]
        GENR --> VER{"deterministic<br/>verification"}
        VER -->|"pass"| ANS["answer + citations"]
        VER -->|"fail"| ABS2["abstain"]
    end

    IDX --> HYB
```

---

## End-to-end flow

1. **Ingestion** ([`ingestion/`](ingestion/), [docs](docs/ingestion.md)). Extracts text and layout from each PDF
   with PyMuPDF. It then cleans repeated headers and footers, recovers the section structure, and attaches
   curated metadata from [`config/document_overrides.toml`](config/document_overrides.toml): organization,
   document type, effective and superseded dates, series id. Corpus integrity is checked against SHA-256 hashes
   in [`config/corpus_lock.json`](config/corpus_lock.json).
2. **Chunking** ([`chunking/`](chunking/), [docs](docs/chunking.md)). Builds section-aware chunks with clause
   numbers, section paths, page ranges and content hashes. Chunk ids are deterministic. The current corpus
   yields 466 retrievable chunks.
3. **Retrieval** ([`retrieval/`](retrieval/)). Uses dense retrieval with
   `Snowflake/snowflake-arctic-embed-m-v1.5` (exact cosine search over a NumPy matrix) and Okapi BM25 with a
   number-aware analyzer. The two rankings are fused with Reciprocal Rank Fusion (k = 60, top 100 of each).
4. **Temporal / version resolution** ([`temporal/`](temporal/), [docs](docs/temporal.md)). Pattern-based intent
   detection (`point_in_time`, `compare`, `current`, `neutral`) selects which version of a multi-version series
   applies. A stable filter then removes the other versions' chunks. If no version matches the requested date,
   the system flags it rather than presenting the wrong version.
5. **Reranking** ([`retrieval/rerank.py`](retrieval/rerank.py)). `cross-encoder/ms-marco-MiniLM-L-6-v2` rescores
   the top 20 candidates after temporal filtering.
6. **Generation** ([`generation/`](generation/), [docs](docs/generation.md)). An evidence gate (abstain when the
   best rerank score is too low) comes first. Context assembly is deterministic, with sources numbered and
   labelled with their metadata. The prompt requires strict JSON claims with verbatim quotes. The default
   provider is Groq (`openai/gpt-oss-20b`, temperature 0, fixed seed).
7. **Evidence verification** ([`generation/validate.py`](generation/validate.py)). Each claim needs at least one
   quote found verbatim, after Unicode, dash, quote-mark and whitespace normalization, in a source the claim
   cites. Every number in a claim must appear in the cited source. Rules also reject claims that merge document
   versions, cite a version without quoting it, or attribute one organization's rule to another. If any check
   fails, the answer becomes an abstention with the reasons recorded.
8. **Adaptive layers** ([`adaptive/`](adaptive/)), on top of the frozen core:
   - [Phase 1](docs/adaptive.md): splits the answer by document version when a version-neutral question's single
     answer is rejected only for version attribution.
   - [Phase 2](docs/multi_intent.md): rule-based decomposition of multi-part questions and evidence fusion.
   - [Phase 3](docs/session.md): rewrites follow-up questions ("Does that still apply under the current
     procedures?") into standalone queries.
   - [Phase 6](docs/streaming.md): a bounded iterative retrieval loop (at most 3 rounds, no model in the loop)
     that runs when the evidence does not cover every organization the question names.

---

## Tech stack

| Purpose | Technologies |
|---|---|
| Language / runtime | Python ≥ 3.11, TypeScript |
| PDF processing | PyMuPDF |
| Data contracts | Pydantic v2 |
| Embeddings and reranking | sentence-transformers, PyTorch (CPU), Snowflake arctic-embed-m v1.5, MS MARCO MiniLM cross-encoder |
| Lexical retrieval | Own Okapi BM25 implementation with Snowball stemming |
| LLM provider | Groq SDK (`openai/gpt-oss-20b`), plus an offline stub provider |
| Services | FastAPI, Uvicorn, httpx |
| Messaging | RabbitMQ (pika) |
| Session state | Redis (redis-py) |
| Persistence | PostgreSQL (psycopg 3), SQL migrations |
| Tool protocol | Model Context Protocol (official `mcp` Python SDK) |
| Observability | OpenTelemetry API / SDK, optional OTLP over HTTP export |
| Frontend | React 18, Vite 6, TypeScript, lucide-react |
| Testing | pytest, Vitest |

---

## Repository structure

```
.
├── ingestion/          PDF extraction, cleaning, structure recovery, metadata, corpus validation
├── chunking/           Section-aware chunking, clause numbering, chunk inspection CLI
├── retrieval/          Dense index, BM25, RRF hybrid, cross-encoder reranker, search CLI
├── temporal/           Version intent detection, version registry, resolution filter
├── generation/         Context assembly, prompt, providers, deterministic verifier, pipeline
├── adaptive/           Phase 1 controller: per-version answer split
│   ├── multi/          Phase 2: multi-intent decomposition and evidence fusion
│   ├── session/        Phase 3: follow-up resolution within a conversation
│   ├── jobs/           Phase 4: job contracts, RabbitMQ / in-memory broker, worker
│   ├── session_store/  Phase 5: in-memory and Redis session stores
│   └── streaming/      Phase 6: bounded iterative retrieval
├── services/           api, orchestrator, retrieval, generation, mcp, persistence, telemetry,
│                       shared contracts and config
├── frontend/           React + Vite inspection workspace
├── evaluation/         One package per evaluation: cases, runner, committed results
├── tests/              Offline pytest suite
├── docs/               Design notes per layer and phase
├── config/             Corpus hash lock, curated document metadata, organization aliases
├── corpus/             The 12 source PDFs (read-only input)
├── corpus_archive/     Superseded captures and their web sources (not ingested)
└── data/               Generated: ingested JSON, chunks, indexes (git-ignored)
```

---

## Getting started

### Prerequisites

- Python 3.11 or newer
- Node.js 18 or newer (for the frontend; Vite 6 requirement)
- Docker, only for the distributed setup (RabbitMQ, Redis, optional PostgreSQL)
- A [Groq](https://console.groq.com/) API key, only for live answers. Without one, the generation service can
  run with the offline stub provider, which always abstains.
- RAM for the embedding model and reranker on CPU. Peak memory use measured during the retrieval evaluation was
  about 1.2 GB. The first run downloads the models from Hugging Face.

### 1. Install

```bash
git clone https://github.com/Rkncodes/streamingliverag.git
cd streamingliverag

python -m venv .venv
source .venv/bin/activate            # Windows PowerShell: .venv\Scripts\Activate.ps1

# CPU build of PyTorch (as recommended in pyproject.toml)
pip install torch --index-url https://download.pytorch.org/whl/cpu

# Core pipeline, tests, and the service stack
pip install -e ".[dev,retrieval,generation,jobs,sessions,services]"
```

Optional extras defined in [`pyproject.toml`](pyproject.toml): `mcp`, `postgres`, `telemetry`,
`telemetry-otlp`.

### 2. Configure

```bash
cp .env.example .env                 # then set GROQ_API_KEY in .env
```

| Variable | Used by | Default / notes |
|---|---|---|
| `GROQ_API_KEY` | generation | Read from `.env` or the shell. Required for `GENERATION_PROVIDER=groq`. |
| `GENERATION_PROVIDER` | generation | `groq`; `offline` = stub model, no API calls |
| `RABBITMQ_URL` | api, orchestrator | Required for the services, e.g. `amqp://guest:guest@localhost:5672/%2F` |
| `REDIS_URL` | api, orchestrator | Required for the services, e.g. `redis://localhost:6379/0` |
| `API_HOST` / `API_PORT` | api | `127.0.0.1` / `8000` |
| `RETRIEVAL_HOST` / `RETRIEVAL_PORT` / `RETRIEVAL_URL` | retrieval / orchestrator, mcp | `127.0.0.1` / `8001` / `http://127.0.0.1:8001` |
| `GENERATION_HOST` / `GENERATION_PORT` / `GENERATION_URL` | generation / orchestrator | `127.0.0.1` / `8002` / `http://127.0.0.1:8002` |
| `RETRIEVAL_MODE`, `MAX_ROUNDS` | orchestrator | `single`, `3` (`iterative` enables the bounded loop) |
| `QUERY_TIMEOUT_S`, `SERVICE_TIMEOUT_S` | api, orchestrator | `180`, `120` |
| `MCP_HOST` / `MCP_PORT` | mcp | `127.0.0.1` / `8003` |
| `DATABASE_URL` | mcp, persistence | Optional. Enables PostgreSQL for `database_query`. |
| `OTEL_TRACES_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_SDK_DISABLED` | all services | Tracing is off unless set |

Only `GROQ_API_KEY` is read from `.env`. Set the service variables in each service's shell. The full reference
is in [`docs/services.md`](docs/services.md) and [`services/config.py`](services/config.py).

### 3. Build the data

`data/` is generated and git-ignored. Build it once from the PDFs in `corpus/`:

```bash
python -m ingestion                  # corpus/ -> data/ingested/
python -m ingestion.validate         # check corpus hashes against config/corpus_lock.json
python -m chunking                   # data/ingested/ -> data/chunks/
python -m retrieval.search "When is a UConn travel card suspended?" --method hybrid --build
                                     # builds data/index/arctic-m/ and runs one hybrid search
```

Building the arctic-m index took about 200 s on an 8-thread CPU in the
[benchmark run](evaluation/retrieval/results/report.md).

### 4. Ask a question from the command line

```bash
python -m generation "When is a UConn travel card suspended?"     # full pipeline; needs GROQ_API_KEY
python -m adaptive.session 'What did the UConn February 2026 procedures say about when a Travel Card is suspended?' \
                           'Does that still apply under the current procedures?'          # a two-turn conversation
```

---

## Running the services

Start the infrastructure:

```bash
docker run -d --name adaptive-rabbitmq -p 5672:5672 rabbitmq:3
docker run -d --name adaptive-redis    -p 6379:6379 redis:7
```

Run each service in its own terminal, with `RABBITMQ_URL` and `REDIS_URL` set in every terminal. PowerShell is
shown below; in bash, use `export VAR=value` instead.

```powershell
$env:RABBITMQ_URL = "amqp://guest:guest@localhost:5672/%2F"
$env:REDIS_URL    = "redis://localhost:6379/0"

python -m services.retrieval                                          # :8001 (loads models and index first)
python -m services.generation                                         # :8002 (set GENERATION_PROVIDER=offline to run without Groq)
python -m services.orchestrator                                       # consumes adaptiverag.jobs
python -m services.api                                                # :8000
```

Optional:

```powershell
python -m services.mcp                                                # MCP server on :8003/mcp (pip install -e ".[mcp]")
$env:OTEL_TRACES_EXPORTER = "console"                                 # print spans to stderr (pip install -e ".[telemetry]")
```

PostgreSQL for the MCP `database_query` tool: see [`docs/database.md`](docs/database.md)
(`python -m services.persistence migrate`, then `load`).

### Frontend

```bash
cd frontend
npm install
npm run dev                          # http://localhost:5180
```

The Vite dev server proxies `/svc/<service>` to the service ports, so the services need no CORS configuration. To
point the proxy at other ports, copy [`frontend/.env.example`](frontend/.env.example) to `.env.local` and edit the
`ADAPTIVERAG_*_URL` values.

---

## API

| Method | Path | Service | Description |
|---|---|---|---|
| `GET` | `/health` | api, retrieval, generation | Liveness and service info |
| `POST` | `/query` | api :8000 | Ask a question within a session. Returns 200 when the job completes (answered or abstained), 422 for an invalid request, 502 if the job failed, 504 on timeout. |
| `GET` | `/sessions/{session_id}` | api :8000 | Read the stored session (all turns), or 404 |
| `POST` | `/retrieve` | retrieval :8001 | Internal: retrieval for the orchestrator and MCP server |
| `POST` | `/generate` | generation :8002 | Internal: grounded answer for the orchestrator |

Request and response models are Pydantic contracts in [`services/contracts.py`](services/contracts.py)
(`extra="forbid"`, versioned with `schema_version`).

```bash
curl -s -X POST http://127.0.0.1:8000/query \
  -H "Content-Type: application/json" \
  -d '{"session_id": "demo-1", "question": "When is a UConn University Travel Card suspended?"}'
```

The response (`QueryResponse`) contains:
- the job `status` and `answer_status` (`answered` or `abstained`, with the reason)
- the answer `text` and `citations` (document, pages, section, clause, effective date, chunk id)
- the follow-up `resolution` (kind, rewritten query, temporal constraint)
- the chosen strategies
- the evidence chunk ids shown to the model

Health check output recorded in the service smoke test ([`docs/services.md`](docs/services.md)):

```
GET :8001/health -> {"status":"ok","service":"retrieval","chunks":466,"reranker":true}
GET :8002/health -> {"status":"ok","service":"generation","provider":"offline-stub","model":"none"}
```

---

## Evaluation

The suites are separate and measure different things. **Retrieval metrics are not answer accuracy.** A
Recall@10 of 1.00 means the gold evidence chunk was in the top 10 results. It does not mean the final answer was
correct.

### Retrieval: 69-query benchmark

[`evaluation/retrieval/`](evaluation/retrieval/) holds 69 hand-written queries. Each has gold evidence chunks
resolved from verbatim quotes. The query types are direct fact, paraphrase, conditional, exception, numeric
threshold, terminology, clause-specific, cross-section and version-sensitive. The cases were frozen before any
model was run, and the gold labels were never changed based on retrieval results.

**Embedding models** (dense only, CPU, exact search), from
[`results/report.md`](evaluation/retrieval/results/report.md):

| Model | R@1 | R@5 | R@10 | MRR@10 |
|---|---|---|---|---|
| **snowflake-arctic-embed-m-v1.5** (selected) | 0.768 | 0.986 | 0.986 | 0.867 |
| bge-base-en-v1.5 | 0.746 | 0.949 | 0.978 | 0.837 |
| bge-small-en-v1.5 | 0.732 | 0.927 | 0.964 | 0.835 |
| e5-base-v2 | 0.703 | 0.942 | 0.971 | 0.811 |
| all-MiniLM-L6-v2 | 0.652 | 0.920 | 0.978 | 0.786 |

Two further candidates (nomic-embed-text-v1.5, mxbai-embed-large-v1) could not be evaluated: one has a library
incompatibility and the other ran out of memory. See
[`NOT_EVALUATED.md`](evaluation/retrieval/results/NOT_EVALUATED.md).

**Retrieval methods**, from [`results/comparison.md`](evaluation/retrieval/results/comparison.md) and
[`results/rerank.md`](evaluation/retrieval/results/rerank.md):

| Method | R@1 | R@5 | R@10 | MRR@10 |
|---|---|---|---|---|
| BM25 | 0.674 | 0.891 | 0.957 | 0.783 |
| Dense (arctic-m) | 0.768 | 0.986 | 0.986 | 0.867 |
| Hybrid RRF | 0.739 | 0.971 | **1.000** | 0.841 |
| Hybrid RRF + cross-encoder rerank | 0.768 | 0.971 | 0.986 | 0.854 |

Hybrid RRF found at least one gold chunk in the top 10 for all 69 queries. Its rank-1 precision is lower than
dense alone. The reranker improved several poorly ranked cases but also demoted others. It pushed one gold chunk
out of the top 10, so its Recall@10 is below plain hybrid. On CPU, reranking 20 candidates costs about 2.2 s per
query (mean).

### Version selection: 18 cases

[`evaluation/temporal/`](evaluation/temporal/) has 18 cases on the two UConn procedure versions: explicit dates,
"current", neutral, comparison, and dates that no version covers. From
[`results/report.md`](evaluation/temporal/results/report.md):

- Intent detected correctly: **18/18**. Requested version selected correctly: **18/18** (including correctly
  reporting "no version available" for a date before both versions).
- Cases with a wrong-version chunk in the top 10 (hybrid RRF): **12 → 0** after temporal resolution.
- Version-neutral queries: top 10 unchanged (3/3).

### End-to-end integration: 27 cases with a live LLM

[`evaluation/integration/`](evaluation/integration/) has 19 answerable cases and 8 where abstention is correct.
Each was run twice through the full pipeline with Groq `openai/gpt-oss-20b`. This is a behavioral suite with
automatic checks (retrieval ranks, version selection, citations, status, regex fact checks), not a large-scale
accuracy benchmark. Frozen baseline from
[`baseline-2026-09-28.md`](evaluation/integration/results/baseline-2026-09-28.md):

| | Run 1 | Run 2 |
|---|---|---|
| Passed all automatic checks | 23/27 | 21/27 |
| Expected abstentions that abstained | 8/8 | 8/8 |
| Answers citing a wrong version, wrong organization, or a source outside the context | 0 | 0 |

A manual reading of every failed case-run classified 7 as checks that were too strict for an answer that was
actually correct, 3 as model errors caught by the verifier (which turned them into abstentions), and 0 as wrong
answers shown to the user. Retrieval, version selection, reranking and context were identical across both runs
(27/27). The verifier is conservative: in an earlier manual review
([`report.md`](evaluation/integration/results/report.md)) it also rejected some substantively correct answers,
for example over quote formatting.

### Adaptive controller vs baseline

[`evaluation/adaptive/results/summary.md`](evaluation/adaptive/results/summary.md) runs the same 27 cases through
the phase 1 adaptive controller:

| | Run 1 | Run 2 |
|---|---|---|
| Adaptive controller | 20/27 | 22/27 |
| Frozen baseline | 23/27 | 21/27 |

**The adaptive controller does not outperform the baseline overall on this suite.** It fixed the one case it
targets (`i-uc-neutral-card`, a version-neutral question whose single answer merged two versions) in both runs,
using the per-version split. The other differences come from LLM output variance on identical evidence and
prompts: every failing case took the unchanged single path.

### Other suites

Offline suites (real retrieval stack, stub model, no LLM calls) check that the multi-intent, session, job,
session-store, iterative-retrieval, services and MCP layers behave exactly like the direct pipeline. Their results
are in `evaluation/<suite>/results/`. Run any suite with `python -m evaluation.<suite>.run`. The live-LLM suites
(`generation`, `integration`, `adaptive`, `multi_intent.live`) need `GROQ_API_KEY` and use API quota.

---

## Testing

```bash
python -m pytest                     # offline Python suite
cd frontend && npm test              # Vitest (frontend model layer)
cd frontend && npm run typecheck     # TypeScript
```

On 2026-10-19, with `data/` built: **844 passed, 8 skipped** (pytest) and **24 passed** (Vitest). The 8 skipped
tests need external resources and run when these are set: RabbitMQ (1, `RABBITMQ_URL`), Redis (2, `REDIS_URL`),
PostgreSQL (4, `ADAPTIVERAG_TEST_DATABASE_URL`), and a live LLM run (1, `RUN_LIVE_LLM=1` plus `GROQ_API_KEY`).

```bash
RABBITMQ_URL=amqp://guest:guest@localhost:5672/%2F REDIS_URL=redis://localhost:6379/0 \
  python -m pytest tests/test_jobs.py tests/test_session_store.py
```

Tests marked `corpus` run against the real PDFs and generated chunks. The retrieval benchmark's `build --check`
also runs in the suite, so it fails if chunking changes and the gold labels go stale.

---

## Limitations

- **Small, curated corpus.** 12 documents and 466 chunks. Only one document series (UConn procedures) has
  multiple versions, so version resolution is exercised on that series alone.
- **Small evaluation sets.** 69 retrieval queries, 18 version cases and 27 end-to-end cases. The results are
  indicative, not statistically strong. All retrieval parameters were fixed before evaluation, and there is no
  held-out set for tuning.
- **Rule-based language understanding.** Version intent, question decomposition and follow-up resolution use
  deterministic patterns. Relative phrasing ("the old rules", "last spring") is not recognized.
- **Conservative verifier.** Exact-quote verification rejects some correct answers, for example when the model
  reformats a quote or repeats a number from the question.
- **Service limitations.** One query at a time per API process, one orchestrator per jobs queue, and no locking on
  sessions. Service calls use plain HTTP without authentication, retries or TLS. There is no job-status endpoint:
  the API waits synchronously for each job.
- **CPU latency.** The cross-encoder adds about 2 s per query on CPU.
- **Not deployed.** The project runs locally. There is no Docker Compose file, CI pipeline or hosted deployment.

### Possible next steps

- A larger benchmark with a held-out split, so retrieval and gate parameters can be tuned without leaking labels.
- More versioned document series, and recognition of relative temporal phrasing.
- Durable job state with a status endpoint, plus authentication and retries between services.
- Docker Compose for the full stack, and CI running the offline test suite.

---

## Documentation

Design notes for each layer are in [`docs/`](docs/):
[ingestion](docs/ingestion.md) · [chunking](docs/chunking.md) · [temporal](docs/temporal.md) ·
[generation](docs/generation.md) · [adaptive](docs/adaptive.md) · [multi-intent](docs/multi_intent.md) ·
[session](docs/session.md) · [jobs](docs/jobs.md) · [session store](docs/session_store.md) ·
[iterative retrieval](docs/streaming.md) · [services](docs/services.md) · [MCP](docs/mcp.md) ·
[database](docs/database.md) · [telemetry](docs/telemetry.md).

Corpus provenance (sources, capture dates, replaced files) is in
[`corpus_archive/README.md`](corpus_archive/README.md).

## License

No license file is included yet. The PDFs in `corpus/` are policy documents published by their respective
universities. They are included as the evaluation corpus. Capture and replacement history is recorded in
[`corpus_archive/README.md`](corpus_archive/README.md).
