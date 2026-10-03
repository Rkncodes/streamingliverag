// One retrieval inspection: a real POST /retrieve for a query of this run, and what it returned. The rounds are
// the RetrievalTrace of that response; a round is listed only if the trace contains it.

import { Play } from "lucide-react";
import { useState } from "react";
import type { RetrievalMode, Round } from "../api/types";
import { ms, seconds, type Inspection, type Run } from "../lib/model";
import { useStore } from "../state/store";
import { Counts, Disclosure, ErrorState, Id, MetricRow, Metrics, Note, Pending, Raw, StatusBadge } from "./ui";

export function RetrievalRound({ round, last, stopReason }: { round: Round; last: boolean; stopReason: string }) {
  const refine = round.decision.startsWith("refine");
  return (
    <div className={`step sub ${round.coverage.decision === "sufficient" ? "done" : "warn"}`}>
      <span className="node" aria-hidden />
      <details open>
        <summary>
          <span className="name">Round {round.iteration}</span>
          <span className="summary">
            {round.strategy.replace(/_/g, " ")}
            {round.target ? ` · ${round.target}` : ""}
          </span>
          <span className="right">
            <StatusBadge tone={round.coverage.decision === "sufficient" ? "ok" : "warn"}>coverage {round.coverage.decision.replace(/_/g, " ")}</StatusBadge>
            <StatusBadge plain>{refine ? "refine" : "stop"}</StatusBadge>
          </span>
        </summary>
        <div className="body">
          <Counts
            items={[
              ["retrieved", round.retrieved.length],
              ["new", round.new.length],
              ["excluded versions", round.excluded_versions.length],
              ["retained", round.retained.length],
              ["in context", round.context.length],
              ["promoted", round.promoted.length],
            ]}
          />
          <Metrics>
            <MetricRow label="Coverage">{round.coverage.reason}</MetricRow>
            <MetricRow label="Decision">
              {round.decision}
              {last ? <span className="faint"> · stop reason {stopReason.replace(/_/g, " ")}</span> : null}
            </MetricRow>
            <MetricRow label="Query of this round">{round.query}</MetricRow>
          </Metrics>
          <Raw label="Chunk ids and coverage signals" value={{ retrieved: round.retrieved, new: round.new, retained: round.retained, context: round.context, promoted: round.promoted, coverage_signals: round.coverage.signals }} />
        </div>
      </details>
    </div>
  );
}

interface Props {
  run: Run;
  inspectionKey: string;
  label: string;
  query: string;
  inspection?: Inspection;
}

export function RetrievalInspector({ run, inspectionKey, label, query, inspection }: Props) {
  const { inspect, health } = useStore();
  const [mode, setMode] = useState<RetrievalMode>(inspection?.request.mode ?? "iterative");
  const [maxRounds, setMaxRounds] = useState(inspection?.request.max_rounds ?? 3);
  const result = inspection?.result;
  const trace = result?.trace ?? null;

  return (
    <div className="panel">
      <div className="pad" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderBottom: "1px solid var(--border-subtle)" }}>
        <strong style={{ fontWeight: 600 }}>{label}</strong>
        <span className="muted" style={{ flex: 1, minWidth: 200 }}>
          {query}
        </span>
        <select className="select" aria-label="Retrieval mode" value={mode} onChange={(e) => setMode(e.target.value as RetrievalMode)}>
          <option value="iterative">iterative</option>
          <option value="single">single</option>
        </select>
        <select className="select" aria-label="Round budget" value={maxRounds} disabled={mode === "single"} onChange={(e) => setMaxRounds(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              max {n}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          disabled={inspection?.pending || health.retrieval.state === "down"}
          onClick={() => void inspect(run.id, inspectionKey, label, query, { mode, maxRounds })}
        >
          <Play aria-hidden /> {inspection ? "Run again" : "Inspect retrieval"}
        </button>
      </div>
      {!inspection ? (
        <div className="pad muted">Not inspected. Sends this query to the retrieval service (POST /retrieve) and shows its evidence and rounds.</div>
      ) : inspection.pending ? (
        <Pending>
          Waiting for <span className="mono">POST /retrieve</span>
        </Pending>
      ) : inspection.error || !result ? (
        <div className="pad">
          <ErrorState title="The retrieval inspection failed">{inspection.error ?? "No response."}</ErrorState>
        </div>
      ) : (
        <div className="pad">
          <Counts
            items={[
              ["mode", result.mode],
              ["evidence", result.evidence.length],
              ["rounds", trace ? trace.rounds.length : "—"],
              ["stop reason", trace ? trace.stop_reason.replace(/_/g, " ") : "—"],
              ["temporal intent", result.resolution.kind.replace(/_/g, " ")],
              ["round trip", ms(inspection.exchange?.ms)],
            ]}
          />
          {result.mode === "single" ? (
            <Note>The frozen single retrieval has no rounds: one hybrid retrieval, temporal resolution and rerank.</Note>
          ) : trace ? (
            <div className="pipeline" style={{ marginTop: 12, marginLeft: -22 }}>
              {trace.rounds.map((round, i) => (
                <RetrievalRound key={round.iteration} round={round} last={i === trace.rounds.length - 1} stopReason={trace.stop_reason} />
              ))}
            </div>
          ) : null}
          {trace && trace.skipped.length ? (
            <Disclosure summary={`${trace.skipped.length} refinement${trace.skipped.length === 1 ? "" : "s"} considered and not issued`}>
              <Metrics>
                {trace.skipped.map((s, i) => (
                  <MetricRow key={i} label={`${s.strategy.replace(/_/g, " ")}: ${s.why}`}>
                    {s.query}
                  </MetricRow>
                ))}
              </Metrics>
            </Disclosure>
          ) : null}
          <Disclosure summary="Request, timings and temporal resolution">
            <Metrics>
              <MetricRow label="Request" mono>
                POST /retrieve · mode={inspection.request.mode} · max_rounds={inspection.request.max_rounds} · k={inspection.request.k}
              </MetricRow>
              <MetricRow label="Request id" mono>
                {result.request_id}
              </MetricRow>
              {Object.entries(result.seconds).map(([stage, value]) => (
                <MetricRow key={stage} label={`Server time: ${stage.replace(/_/g, " ")}`} mono>
                  {seconds(value)}
                </MetricRow>
              ))}
              <MetricRow label="Temporal trigger">{result.resolution.trigger}</MetricRow>
              <MetricRow label="Selected versions">
                {Object.keys(result.resolution.selected).length
                  ? Object.entries(result.resolution.selected).map(([series, docs]) => (
                      <div key={series}>
                        <Id>{series}</Id> → {docs.map((d) => <Id key={d}>{d}</Id>)}
                      </div>
                    ))
                  : null}
              </MetricRow>
              <MetricRow label="Candidates seen">{result.resolution.candidates}</MetricRow>
              <MetricRow label="Dropped (other versions)">{result.resolution.dropped.length}</MetricRow>
            </Metrics>
          </Disclosure>
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            A retrieval the retrieval service ran for this page's request. The rounds are this response's own RetrievalTrace. The server timings are
            those of the first retrieval; the service reports no time per round.
          </p>
        </div>
      )}
    </div>
  );
}
