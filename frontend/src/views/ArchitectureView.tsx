// How the system is built. Every component named here exists in the repository (services/, adaptive/, docs/).

import { Section, ViewHead } from "../components/ui";

const PATH: [string, string, string][] = [
  ["Client", "this page", "POST /query with a question and a session id"],
  ["API", "services/api · :8000", "Validates the request, submits it as a job, waits for the job's final event, returns the stored turn"],
  ["RabbitMQ", "adaptiverag.jobs / job_events", "Carries the job to the orchestrator and its events back"],
  ["Orchestrator", "services/orchestrator", "Runs the controllers below; loads and stores the session; calls retrieval and generation over HTTP"],
  ["Retrieval", "services/retrieval · :8001", "Answers each retrieval the controllers ask for"],
  ["Generation", "services/generation · :8002", "Answers each grounded answer the controllers ask for"],
  ["Redis", "session store", "Holds the conversation; the API reads the answered turn from it"],
];

const CONTROLLERS: [string, string, string][] = [
  ["Session resolution", "adaptive/session", "Decides whether a question stands alone or follows an earlier turn, and rewrites a follow-up into a standalone query. Rules, no model."],
  ["Multi-intent decomposition", "adaptive/multi", "Splits a multi-part question into intents, retrieves for each, and chooses how to answer: delegate, fuse the evidence, or answer per intent."],
  ["Adaptive answer", "adaptive/controller", "Answers once, or splits the answer by document version when versions disagree."],
  ["Iterative retrieval", "adaptive/streaming", "Runs inside the retrieval service: retrieve, judge coverage, refine the query, at most a fixed number of rounds. No model in the loop."],
];

const RETRIEVAL: [string, string][] = [
  ["Dense + BM25", "Two retrievers over the chunked corpus (the project's own arctic-m dense index and BM25), fused by reciprocal rank"],
  ["Temporal resolution", "Selects the document version the question asks about (a date, or “currently”) and drops the others"],
  ["Rerank", "A cross-encoder scores each candidate against the question"],
  ["Coverage", "Sufficient when every organization the question names has a relevant source in the context"],
];

const GENERATION: [string, string][] = [
  ["Relevance gate", "Abstains without a model call when no source is relevant enough"],
  ["Grounded prompt", "The model sees labelled sources (S1, S2, …) and must quote what it uses"],
  ["Verifier", "Each claim's quotes are checked against the source text; an unverified answer is rejected"],
  ["Abstention", "Insufficient evidence is an answer status, not an error"],
];

const AROUND: [string, string, string][] = [
  ["MCP server", "services/mcp · :8003", "Three read-only tools over the same retrieval and metadata: document_search, metadata_lookup, database_query"],
  ["PostgreSQL", "services/persistence", "A copy of the document and chunk metadata, behind database_query's named queries"],
  ["OpenTelemetry", "services/telemetry", "A span for every service boundary and every retrieval round; correlation ids on every span; no payload recorded"],
];

function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="panel table-wrap">
      <table className="table">
        <tbody>
          {rows.map(([name, where, text], i) => (
            <tr key={name}>
              <td className="mono faint" style={{ width: 36 }}>
                {String(i + 1).padStart(2, "0")}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <strong style={{ fontWeight: 600 }}>{name}</strong>
                <div className="mono faint">{where}</div>
              </td>
              <td className="muted">{text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <div className="panel">
      <div className="pad">
        <dl className="kvs">
          {rows.map(([k, v]) => (
            <div className="kv" key={k}>
              <dt>{k}</dt>
              <dd className="muted">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function ArchitectureView() {
  return (
    <div className="view">
      <ViewHead title="Architecture">How a query travels through the system, and what each part is responsible for.</ViewHead>
      <Section title="The path of a query">
        <Table rows={PATH} />
      </Section>
      <Section title="Controllers the orchestrator runs" aside="outermost first">
        <Table rows={CONTROLLERS} />
      </Section>
      <div className="two" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <Section title="Inside retrieval">
          <Facts rows={RETRIEVAL} />
        </Section>
        <Section title="Inside generation">
          <Facts rows={GENERATION} />
        </Section>
      </div>
      <Section title="Around the pipeline">
        <Table rows={AROUND} />
      </Section>
      <p className="faint" style={{ fontSize: 12.5 }}>
        There is no separate vector database: the dense index is part of the retrieval service. Trace context crosses the HTTP calls but not
        RabbitMQ; the job id joins the two traces.
      </p>
    </div>
  );
}
