// The pipeline of one run, stage by stage, from what the backend returned: POST /query (the summary), the stored
// turn (GET /sessions/{id}: resolution, decomposition, per-intent records, phase 1 answers) and the retrieval
// inspections. A stage whose data the backend did not return says so; no stage is drawn that did not happen.

import type { ReactNode } from "react";
import type { IntentRecord, Phase1Answer } from "../api/types";
import { inspectionsOf, score, words, type Run } from "../lib/model";
import { useStore } from "../state/store";
import { RetrievalInspector } from "./RetrievalInspector";
import { Counts, Id, MetricRow, Metrics, Note, Pending, Raw, StatusBadge, type Tone } from "./ui";

type StepState = "done" | "warn" | "err" | "idle";

export function ExecutionStep(props: { name: string; summary?: ReactNode; state?: StepState; badges?: ReactNode; open?: boolean; children?: ReactNode }) {
  const { name, summary, state = "done", badges, open, children } = props;
  return (
    <div className={`step ${state === "idle" ? "" : state}`}>
      <span className="node" aria-hidden />
      <details open={open}>
        <summary>
          <span className="name">{name}</span>
          {summary ? <span className="summary">{summary}</span> : null}
          {badges ? <span className="right">{badges}</span> : null}
        </summary>
        {children ? <div className="body">{children}</div> : null}
      </details>
    </div>
  );
}

function statusTone(status: string | undefined): Tone {
  return status === "answered" ? "ok" : status === "abstained" ? "warn" : "neutral";
}

export function IntentCard({ intent, total }: { intent: IntentRecord; total: number }) {
  return (
    <div className="panel intent">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="eyebrow" style={{ margin: 0 }}>
          Intent {intent.index + 1} of {total}
        </span>
        {intent.status ? <StatusBadge tone={statusTone(intent.status)}>{intent.status}</StatusBadge> : null}
      </div>
      <div className="q">{intent.text}</div>
      <Metrics>
        {intent.sub_query !== intent.text ? <MetricRow label="Sub-query">{intent.sub_query}</MetricRow> : null}
        <MetricRow label="Organizations">{intent.organizations.join(", ")}</MetricRow>
        {intent.outside_corpus?.length ? <MetricRow label="Outside the corpus">{intent.outside_corpus.join(", ")}</MetricRow> : null}
        {intent.temporal_intent ? <MetricRow label="Temporal intent">{intent.temporal_intent.replace(/_/g, " ")}</MetricRow> : null}
        {intent.retrieved ? <MetricRow label="Retrieved">{intent.retrieved.length} chunks</MetricRow> : null}
        {intent.best_rerank !== undefined ? (
          <MetricRow label="Best relevance" mono>
            {score(intent.best_rerank)}
          </MetricRow>
        ) : null}
        {intent.admissible !== undefined ? <MetricRow label="Admissible">{intent.admissible ? "yes" : "no"}</MetricRow> : null}
        {intent.covered_by_question_context !== undefined ? (
          <MetricRow label="Covered by the whole-question context">{intent.covered_by_question_context ? "yes" : "no"}</MetricRow>
        ) : null}
        {intent.citations ? <MetricRow label="Citations">{intent.citations.length ? intent.citations.map((n) => `[${n}]`).join(" ") : "none"}</MetricRow> : null}
      </Metrics>
      <Raw label="Stored intent record" value={intent} />
    </div>
  );
}

function Generation({ part, index, total }: { part: Phase1Answer; index: number; total: number }) {
  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="pad">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <strong style={{ fontWeight: 600 }}>{total > 1 ? `Answer ${index + 1} of ${total}` : "Answer"}</strong>
          <StatusBadge tone={statusTone(part.status)}>{part.status}</StatusBadge>
          <StatusBadge plain>{words(part.decision.strategy)}</StatusBadge>
        </div>
        <Metrics>
          {total > 1 ? <MetricRow label="Question">{part.question}</MetricRow> : null}
          <MetricRow label="Decision">{part.decision.reason}</MetricRow>
          <MetricRow label="Provider" mono>
            {part.provider}
          </MetricRow>
          <MetricRow label="Model" mono>
            {part.model}
          </MetricRow>
          <MetricRow label="Prompt version" mono>
            {part.prompt_version}
          </MetricRow>
          <MetricRow label="Sources shown">{part.sources_considered.length}</MetricRow>
          <MetricRow label="Verified claims">{part.claims.length}</MetricRow>
          <MetricRow label="Citations">{part.citations.length}</MetricRow>
          {part.abstention_reason ? (
            <MetricRow label="Abstention">
              <Id>{part.abstention_reason}</Id> {part.abstention_detail}
            </MetricRow>
          ) : null}
          {part.parts.length ? <MetricRow label="Version parts">{part.parts.map((p) => p.label ?? p.doc_id).join(" · ")}</MetricRow> : null}
          {part.verification_problems.length ? <MetricRow label="Verifier problems">{part.verification_problems.join(" · ")}</MetricRow> : null}
          {part.verification_notes.length ? <MetricRow label="Verifier notes">{part.verification_notes.join(" · ")}</MetricRow> : null}
          {part.not_in_sources.length ? <MetricRow label="Not in the sources">{part.not_in_sources.join(" · ")}</MetricRow> : null}
        </Metrics>
        <Raw label="Decision signals" value={part.decision.signals ?? {}} />
      </div>
    </div>
  );
}

export function ExecutionPipeline({ run }: { run: Run }) {
  const { navigate } = useStore();
  const r = run.response;
  if (run.pending) return <Pending>The query is running. The pipeline is shown when the job has answered.</Pending>;
  if (!r || run.error) return <Note tone="err">This run has no response to show: {run.error ?? "no data"}</Note>;
  if (r.status === "failed") {
    return (
      <div className="pipeline">
        <ExecutionStep name="Query" summary={run.question} open />
        <ExecutionStep name="Job failed" state="err" summary={r.error?.type} open>
          <Note tone="err">
            The pipeline raised <span className="mono">{r.error?.type}</span>; the API answered HTTP 502 and stored nothing. The stage that failed is in
            the error message.
            <pre className="raw">{r.error?.message}</pre>
          </Note>
        </ExecutionStep>
      </div>
    );
  }

  const turn = run.turn;
  const answer = turn?.answer ?? null;
  const resolution = turn?.resolution ?? r.resolution;
  const unresolved = resolution?.kind === "unresolved";
  const inspections = inspectionsOf(run);
  const whole = run.inspections["question"];
  const multi = answer?.decomposition.multi ?? false;
  const intents = answer?.intents ?? [];
  const rewritten = resolution && resolution.query && resolution.query !== run.question;

  return (
    <div className="pipeline">
      <ExecutionStep name="Query" summary={run.question} open>
        <Metrics>
          <MetricRow label="Session" mono>
            {r.session_id}
          </MetricRow>
          <MetricRow label="Turn">{r.turn_index}</MetricRow>
          <MetricRow label="Job" mono>
            {r.job_id}
          </MetricRow>
        </Metrics>
      </ExecutionStep>

      <ExecutionStep
        name="Session resolution"
        state={unresolved ? "warn" : "done"}
        summary={resolution?.reason}
        badges={resolution ? <StatusBadge tone={resolution.kind === "follow_up" ? "info" : unresolved ? "warn" : "neutral"}>{words(resolution.kind)}</StatusBadge> : null}
        open
      >
        {resolution ? (
          <Metrics>
            <MetricRow label="Reason">{resolution.reason}</MetricRow>
            {resolution.anchor != null ? <MetricRow label={unresolved ? "Refers to" : "Resolved against"}>turn {resolution.anchor} of this session</MetricRow> : null}
            <MetricRow label={rewritten ? "Query sent to the pipeline (rewritten)" : "Query sent to the pipeline"}>
              {unresolved ? <span className="faint">none: the turn was not run</span> : resolution.query}
            </MetricRow>
            <MetricRow label="Temporal constraint">{resolution.temporal || <span className="faint">none</span>}</MetricRow>
            <MetricRow label="Organizations">{resolution.organizations.length ? resolution.organizations.join(", ") : <span className="faint">none named</span>}</MetricRow>
          </Metrics>
        ) : null}
        {turn ? <Raw label="Resolution signals" value={turn.resolution.signals} /> : null}
      </ExecutionStep>

      {unresolved ? (
        <ExecutionStep name="Stopped" state="warn" summary="No retrieval and no model call were made" open>
          <Note tone="warn">The follow-up could not be tied to earlier context safely, so the pipeline abstained before retrieving anything.</Note>
        </ExecutionStep>
      ) : (
        <>
          <ExecutionStep
            name="Intent analysis"
            state={answer ? "done" : "idle"}
            summary={answer ? answer.decomposition.reason : run.turnError ? "stored turn not available" : "loading the stored turn"}
            badges={answer ? <StatusBadge plain>{multi ? `${answer.decomposition.intents.length} intents` : "1 intent"}</StatusBadge> : null}
            open
          >
            {answer ? (
              multi ? (
                <div className="intent-grid">
                  {intents.map((intent) => (
                    <IntentCard key={intent.index} intent={intent} total={intents.length} />
                  ))}
                </div>
              ) : (
                <p className="muted">The question was not split: it is answered as one intent. {answer.decomposition.flags.length ? `Flags: ${answer.decomposition.flags.join(", ")}.` : ""}</p>
              )
            ) : run.turnError ? (
              <Note tone="warn">The decomposition is in the stored turn, which could not be read: {run.turnError}</Note>
            ) : (
              <Pending>Reading the stored turn</Pending>
            )}
          </ExecutionStep>

          <ExecutionStep
            name="Retrieval"
            state={inspections.some((i) => i.result) ? "done" : "idle"}
            summary={
              whole?.result
                ? `${whole.result.mode} · ${whole.result.evidence.length} chunks${whole.result.trace ? ` · ${whole.result.trace.rounds.length} round${whole.result.trace.rounds.length === 1 ? "" : "s"} · stop: ${whole.result.trace.stop_reason.replace(/_/g, " ")}` : ""}`
                : "not inspected"
            }
            open
          >
            <Note>
              The orchestrator does not return its retrieval trace, and the API does not say which mode it runs in. Each panel below is a separate,
              real request to the retrieval service for the same query text; retrieval is deterministic, so in the same mode it repeats what the
              orchestrator received.
            </Note>
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              {resolution?.query ? (
                <RetrievalInspector run={run} inspectionKey="question" label="Whole question" query={resolution.query} inspection={whole} />
              ) : null}
              {multi
                ? intents.map((intent) => (
                    <RetrievalInspector
                      key={intent.index}
                      run={run}
                      inspectionKey={`intent-${intent.index}`}
                      label={`Intent ${intent.index + 1}`}
                      query={intent.sub_query}
                      inspection={run.inspections[`intent-${intent.index}`]}
                    />
                  ))
                : null}
            </div>
          </ExecutionStep>

          <ExecutionStep
            name="Evidence fusion"
            state={answer ? "done" : "idle"}
            summary={answer ? answer.reason : r.strategy ? words(r.strategy) : undefined}
            badges={r.strategy ? <StatusBadge plain>{r.strategy.replace(/_/g, " ")}</StatusBadge> : null}
            open
          >
            <Counts
              items={[
                ["strategy", r.strategy ?? "—"],
                ["chunks shown to the model", r.evidence.length],
                ["intents", answer ? (multi ? intents.length : 1) : "—"],
              ]}
            />
            <p className="muted">{words(r.strategy)}.</p>
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => navigate("evidence")}>
              Inspect the evidence
            </button>
          </ExecutionStep>

          <ExecutionStep
            name="Generation"
            state={answer ? (answer.phase1.some((p) => p.status === "answered") ? "done" : "warn") : "idle"}
            summary={answer ? `${answer.phase1.length} model answer${answer.phase1.length === 1 ? "" : "s"} · ${r.answer_strategies.map(words).join(", ")}` : undefined}
            open
          >
            {answer ? (
              answer.phase1.length ? (
                answer.phase1.map((part, i) => <Generation key={i} part={part} index={i} total={answer.phase1.length} />)
              ) : (
                <p className="muted">No model answer was produced for this turn.</p>
              )
            ) : (
              <p className="muted">The generation records are in the stored turn{run.turnError ? `, which could not be read: ${run.turnError}` : "."}</p>
            )}
          </ExecutionStep>
        </>
      )}

      <ExecutionStep
        name="Answer"
        state={r.answer_status === "answered" ? "done" : "warn"}
        summary={r.answer_status === "answered" ? `${r.citations.length} citation${r.citations.length === 1 ? "" : "s"}` : words(r.abstention_reason)}
        badges={<StatusBadge tone={r.answer_status === "answered" ? "ok" : "warn"}>{r.answer_status}</StatusBadge>}
        open
      >
        <button className="btn small" onClick={() => navigate("query")}>
          Open the answer
        </button>
      </ExecutionStep>
    </div>
  );
}
