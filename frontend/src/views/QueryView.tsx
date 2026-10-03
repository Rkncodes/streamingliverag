// The query workspace: ask, read the answer and its citations, and see the evidence the model was shown.

import { AnswerPanel, CitationList } from "../components/AnswerPanel";
import { EvidencePanel } from "../components/EvidencePanel";
import { QueryComposer } from "../components/QueryComposer";
import { EmptyState, Note, Section, StatusBadge, ViewHead } from "../components/ui";
import { clock, evidenceShown, words, type Run } from "../lib/model";
import { useStore } from "../state/store";

function RunList({ runs, selected }: { runs: Run[]; selected: Run | null }) {
  const { selectRun } = useStore();
  return (
    <div className="run-list rows">
      {[...runs].reverse().map((run) => {
        const r = run.response;
        const state = run.pending ? "running" : run.error ? "error" : r?.status === "failed" ? "failed" : (r?.answer_status ?? "");
        return (
          <button key={run.id} className={run.id === selected?.id ? "on" : ""} onClick={() => selectRun(run.id)}>
            <span className="q">{run.question}</span>
            <StatusBadge tone={state === "answered" ? "ok" : state === "abstained" || state === "running" ? "warn" : "err"}>{state}</StatusBadge>
            <span className="meta">
              {clock(run.startedAt)} · <span className="mono">{run.sessionId}</span>
              {r?.turn_index != null ? ` · turn ${r.turn_index}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function QueryView() {
  const { runs, run, navigate, health } = useStore();
  const r = run?.response;
  const shown = run ? evidenceShown(run) : [];
  return (
    <div className="view">
      <ViewHead title="Query">Ask the policy corpus. The answer is grounded in retrieved chunks, or the system abstains.</ViewHead>
      {health.api.state === "down" ? (
        <div style={{ marginBottom: 16 }}>
          <Note tone="err">
            <strong>The API is not reachable.</strong> Queries cannot run until <span className="mono">{__SERVICE_TARGETS__.api}</span> answers. {health.api.error}
          </Note>
        </div>
      ) : null}
      <div className="workspace">
        <div>
          <div className="section">
            <QueryComposer />
          </div>
          {run ? (
            <>
              <div className="section">
                <AnswerPanel run={run} />
              </div>
              {r && r.status === "completed" && r.citations.length ? (
                <Section title="Citations" aside="select one to highlight its evidence">
                  <CitationList citations={r.citations} />
                </Section>
              ) : null}
              {r?.resolution && r.resolution.query && r.resolution.query !== run.question ? (
                <Section title="Resolved query" aside={words(r.resolution.kind)}>
                  <Note>
                    The session turned this follow-up into a standalone query before retrieval:
                    <div style={{ color: "var(--text)", marginTop: 4 }}>{r.resolution.query}</div>
                    <div style={{ marginTop: 4 }}>{r.resolution.reason}</div>
                  </Note>
                </Section>
              ) : null}
            </>
          ) : (
            <EmptyState title="No query yet">Type a question, or pick one of the examples from the evaluation material, then run it.</EmptyState>
          )}
        </div>
        <aside className="side">
          {run && r?.status === "completed" ? (
            <div className="panel">
              <header>
                <h3>Evidence shown to the model</h3>
                <span className="right">
                  <button className="btn small ghost" onClick={() => navigate("evidence")}>
                    Open
                  </button>
                </span>
              </header>
              {shown.length ? (
                <EvidencePanel entries={shown} compact />
              ) : (
                <div className="pad muted">{r.resolution?.kind === "unresolved" ? "Nothing was retrieved for this turn." : "No chunk was shown to the model."}</div>
              )}
            </div>
          ) : null}
          {runs.length ? (
            <div className="panel">
              <header>
                <h3>Runs in this tab</h3>
                <span className="right faint mono">{runs.length}</span>
              </header>
              <RunList runs={runs} selected={run} />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
