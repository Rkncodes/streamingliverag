// The answer of one run, exactly as POST /query returned it: answered text with its citation markers, an
// abstention shown as an abstention, a failed job shown as a failure. Nothing is substituted.

import { Activity, FileText, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import type { Citation } from "../api/types";
import { abstentionTitle, ms, segments, words, type Run } from "../lib/model";
import { useStore } from "../state/store";
import { ErrorState, Id, Pending, StatusBadge } from "./ui";

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="mono">{Math.max(0, Math.round((now - new Date(since).getTime()) / 1000))} s</span>;
}

export function CitationList({ citations }: { citations: Citation[] }) {
  const { highlight, setHighlight } = useStore();
  if (!citations.length) return null;
  return (
    <div className="panel rows" aria-label="Citations">
      {citations.map((c) => {
        const on = highlight.includes(c.number);
        const where = [c.pages || null, c.section, c.clause ? `clause ${c.clause}` : null].filter(Boolean).join(" · ");
        return (
          <button key={c.number} className={`citation ${on ? "on" : ""}`} onClick={() => setHighlight(on ? [] : [c.number])} aria-pressed={on}>
            <span className="n">[{c.number}]</span>
            <span>
              <span className="doc">{c.document ?? c.doc_id}</span>
              <br />
              <span className="where">
                {[c.organization, where, c.effective_date ? `effective ${c.effective_date}` : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="mono faint" title="The context label the model saw">
              {c.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function AnswerPanel({ run }: { run: Run }) {
  const { navigate, highlight, setHighlight } = useStore();
  const r = run.response;

  if (run.pending) {
    return (
      <div className="panel">
        <Pending>
          Waiting for <span className="mono">POST /query</span>: the job runs retrieval and generation before it answers. <Elapsed since={run.startedAt} />
        </Pending>
      </div>
    );
  }
  if (run.error || !r) {
    return (
      <ErrorState title="The query did not complete">
        {run.error ?? "No response."}
        {run.exchange?.status ? (
          <>
            {" "}
            <span className="mono">HTTP {run.exchange.status}</span>
          </>
        ) : null}
      </ErrorState>
    );
  }
  if (r.status === "failed") {
    return (
      <ErrorState title="The job failed">
        The pipeline raised <span className="mono">{r.error?.type ?? "an error"}</span> and the API answered HTTP 502. Nothing was stored for this
        turn.
        <pre className="raw">{r.error?.message ?? ""}</pre>
        <span className="faint">
          job <span className="mono">{r.job_id}</span>
        </span>
      </ErrorState>
    );
  }

  const answered = r.answer_status === "answered";
  const detail = run.turn?.answer?.abstention_detail;
  return (
    <div className="panel">
      <div className="answer">
        <div className="answer-head">
          <span className="eyebrow">Answer</span>
          <StatusBadge tone={answered ? "ok" : "warn"}>{answered ? "Answered" : "Abstained"}</StatusBadge>
          {r.resolution ? <StatusBadge tone={r.resolution.kind === "follow_up" ? "info" : "neutral"}>{words(r.resolution.kind)}</StatusBadge> : null}
          <span className="right">
            <button className="btn small ghost" onClick={() => navigate("execution")}>
              <Workflow aria-hidden /> Execution
            </button>
            <button className="btn small ghost" onClick={() => navigate("evidence")}>
              <FileText aria-hidden /> Evidence
            </button>
            <button className="btn small ghost" onClick={() => navigate("telemetry")}>
              <Activity aria-hidden /> Telemetry
            </button>
          </span>
        </div>
        <div className="question-line">{run.question}</div>
        {answered ? (
          <div className="answer-text">
            {segments(r.text ?? "", r.citations).map((s, i) =>
              s.kind === "text" ? (
                <span key={i}>{s.text}</span>
              ) : (
                <button
                  key={i}
                  className={`marker ${highlight.includes(s.number) ? "on" : ""}`}
                  onClick={() => setHighlight(highlight.includes(s.number) ? [] : [s.number])}
                  aria-label={`Citation ${s.number}`}
                >
                  {s.number}
                </button>
              ),
            )}
          </div>
        ) : (
          <div className="abstained">
            <h3>{abstentionTitle(r.abstention_reason)}</h3>
            <p>
              {words(r.abstention_reason)}. The system returned no answer rather than an ungrounded one.
              {r.resolution?.kind === "unresolved" ? " No retrieval and no model call were made for this turn." : ""}
            </p>
            <p style={{ marginTop: 8 }}>
              <span className="faint">abstention_reason</span> <Id>{r.abstention_reason ?? "none"}</Id>
            </p>
            {detail ? <p style={{ marginTop: 8 }}>{detail}</p> : null}
            {r.text ? (
              <p style={{ marginTop: 8 }} className="faint">
                Response text: “{r.text}”
              </p>
            ) : null}
          </div>
        )}
      </div>
      <div className="pad" style={{ borderTop: "1px solid var(--border-subtle)", display: "flex", gap: 14, flexWrap: "wrap", color: "var(--text-2)", fontSize: 12.5, padding: "9px 20px" }}>
        <span>turn {r.turn_index}</span>
        <span>{r.citations.length} citation{r.citations.length === 1 ? "" : "s"}</span>
        <span>{r.evidence.length} chunk{r.evidence.length === 1 ? "" : "s"} shown to the model</span>
        {r.strategy ? <span title={words(r.strategy)}>strategy {r.strategy}</span> : null}
        <span title="Time from sending POST /query to its response, measured in this browser">{ms(run.exchange?.ms)}</span>
      </div>
    </div>
  );
}
