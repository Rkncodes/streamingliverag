// Telemetry of one run: the identifiers that tie its requests and spans together, the requests this page made,
// and the traces as far as responses describe them. See components/TraceTree.tsx for what is first-hand.

import type { Exchange } from "../api/client";
import { TraceTree, inspectionTrace, jobRows, queryTrace, recorded } from "../components/TraceTree";
import { Counts, EmptyState, Id, MetricRow, Metrics, Note, Section, StatusBadge, ViewHead } from "../components/ui";
import { clock, inspectionsOf, ms } from "../lib/model";
import { useStore } from "../state/store";
import { RunPicker } from "./RunPicker";

function Recording({ exchange }: { exchange: Exchange | undefined }) {
  if (!exchange || exchange.status == null) return <StatusBadge>no response</StatusBadge>;
  return recorded(exchange) ? <StatusBadge tone="ok">recording spans</StatusBadge> : <StatusBadge tone="warn">not recording</StatusBadge>;
}

function ExchangeRow({ label, exchange }: { label: string; exchange: Exchange }) {
  return (
    <tr>
      <td className="mono">
        {exchange.method} {label}
      </td>
      <td>{exchange.service}</td>
      <td className="mono">{exchange.status ?? "—"}</td>
      <td className="mono">{ms(exchange.ms)}</td>
      <td className="mono">{clock(exchange.startedAt)}</td>
      <td>{exchange.sent ? <Id>{exchange.sent.traceId}</Id> : <span className="faint">none sent</span>}</td>
      <td>{exchange.received ? <Id>{exchange.received.spanId}</Id> : <span className="faint">not recorded</span>}</td>
    </tr>
  );
}

export function TelemetryView() {
  const { run, navigate } = useStore();
  const r = run?.response;
  if (!run || run.pending) {
    return (
      <div className="view">
        <ViewHead title="Telemetry" actions={<RunPicker />}>
          Correlation ids, trace context and the requests behind one run.
        </ViewHead>
        <EmptyState
          title={run ? "The query is still running" : "No run to show"}
          action={
            run ? undefined : (
              <button className="btn" onClick={() => navigate("query")}>
                Go to Query
              </button>
            )
          }
        >
          {run ? "Its telemetry appears when the job has answered." : "Run a query first."}
        </EmptyState>
      </div>
    );
  }
  const inspections = inspectionsOf(run).filter((i) => i.exchange);
  const whole = run.inspections["question"]?.result;
  const query = queryTrace(run);
  const apiRecording = recorded(run.exchange);

  return (
    <div className="view">
      <ViewHead title="Telemetry" actions={<RunPicker />}>
        Correlation ids, trace context and the requests behind one run. Spans are exported by the services; this page shows what the responses
        confirm.
      </ViewHead>

      <Section title="Run">
        <Counts
          items={[
            ["job status", r?.status ?? "no response"],
            ["answer status", r?.answer_status ?? "—"],
            ["chunks shown", r ? r.evidence.length : "—"],
            ["retrieval rounds (inspection)", whole?.trace ? whole.trace.rounds.length : "—"],
            ["stop reason (inspection)", whole?.trace ? whole.trace.stop_reason.replace(/_/g, " ") : "—"],
            ["POST /query round trip", ms(run.exchange?.ms)],
          ]}
        />
      </Section>

      <div className="two" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <Section title="Application correlation" aside="travels in the contracts">
          <div className="panel">
            <div className="pad">
              <Metrics>
                <MetricRow label="correlation_id">{r?.job_id ? <Id>{r.job_id}</Id> : null}</MetricRow>
                <MetricRow label="job_id">{r?.job_id ? <Id>{r.job_id}</Id> : null}</MetricRow>
                <MetricRow label="request_id">{r?.request_id ? <Id>{r.request_id}</Id> : <Id>{run.requestId}</Id>}</MetricRow>
                <MetricRow label="session_id">
                  <Id>{run.sessionId}</Id>
                </MetricRow>
              </Metrics>
              <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                Every span of the job carries <span className="mono">correlation_id</span> = the job id, in every service. It is what joins the traces
                below.
              </p>
            </div>
          </div>
        </Section>
        <Section title="OpenTelemetry trace context" aside="travels in HTTP headers">
          <div className="panel">
            <div className="pad">
              <Metrics>
                <MetricRow label="API">
                  <Recording exchange={run.exchange} />
                </MetricRow>
                <MetricRow label="Trace id (POST /query)">{run.exchange?.sent ? <Id>{run.exchange.sent.traceId}</Id> : null}</MetricRow>
                <MetricRow label="Parent span sent">{run.exchange?.sent ? <Id>{run.exchange.sent.spanId}</Id> : null}</MetricRow>
                <MetricRow label="API server span">
                  {run.exchange?.received ? <Id>{run.exchange.received.spanId}</Id> : <span className="faint">not recorded</span>}
                </MetricRow>
              </Metrics>
              <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                {apiRecording
                  ? "The API answered with a traceresponse header: it recorded a server span in the trace this page started."
                  : "The API sent no traceresponse header: it is running without a trace exporter (the default), so it recorded no span. The ids above are the context this page sent."}
              </p>
            </div>
          </div>
        </Section>
      </div>

      <Section title="Requests this page made for the run" aside="round trips measured in this browser">
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Operation</th>
                <th>Service</th>
                <th>Status</th>
                <th>Round trip</th>
                <th>Started</th>
                <th>Trace id sent</th>
                <th>Server span</th>
              </tr>
            </thead>
            <tbody>
              {run.exchange ? <ExchangeRow label="/query" exchange={run.exchange} /> : null}
              {run.turnExchange ? <ExchangeRow label="/sessions/{session_id}" exchange={run.turnExchange} /> : null}
              {inspections.map((i) => (
                <ExchangeRow key={i.key} label={`/retrieve (${i.label.toLowerCase()})`} exchange={i.exchange!} />
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Traces">
        <TraceTree title="Trace 1 · the query request" traceId={query.traceId} rows={query.rows} badge={<Recording exchange={run.exchange} />} />
        <div className="boundary">RabbitMQ: the job message carries no trace context · joined by correlation_id {r?.job_id ? r.job_id.slice(0, 8) + "…" : ""}</div>
        <TraceTree
          title="Trace 2 · the job in the orchestrator"
          traceId={null}
          rows={jobRows(run)}
          badge={<StatusBadge>recording state not reported</StatusBadge>}
          note={
            <>
              The orchestrator starts its own trace for each job, and its calls to the retrieval and generation services continue that trace over
              HTTP. Its trace and span ids exist only in the exporter: no response carries them, and the API does not report whether the
              orchestrator is recording. The rows are the spans it exports for a job, filled with what the responses say about this one. To
              find them in a trace backend, search for <span className="mono">correlation_id = {r?.job_id ?? "the job id"}</span>.
            </>
          }
        />
        {inspections.length ? <div className="boundary">Separate requests from this page: each starts its own trace</div> : null}
        {inspections.map((i) => {
          const t = inspectionTrace(i);
          return (
            <TraceTree
              key={i.key}
              title={`Retrieval inspection · ${i.label.toLowerCase()}`}
              traceId={t.traceId}
              rows={t.rows}
              badge={<Recording exchange={i.exchange} />}
              note="The round rows are the rounds of this response's RetrievalTrace. The retrieval service exports one retrieval.round span per round; span durations are in the exporter."
            />
          );
        })}
      </Section>

      <Note>
        Span attributes never contain the question, the answer, chunk text or ids of chunks, headers or connection strings: the services pass
        every attribute through one allow-list. Exception messages are not recorded either, only their type.
      </Note>
    </div>
  );
}
