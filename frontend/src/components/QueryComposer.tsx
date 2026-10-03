// The query input. Its controls are the parameters the backend really takes: the question and the session id of
// POST /query, and, for the optional retrieval inspection, the mode and round budget of POST /retrieve.
// POST /query itself has no retrieval-mode parameter: the orchestrator's mode is its own setting (RETRIEVAL_MODE).

import { CornerDownLeft, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RetrievalMode } from "../api/types";
import { EXAMPLES, type Example } from "../examples";
import { useStore } from "../state/store";
import { Id } from "./ui";

export function QueryComposer() {
  const { ask, busy, run: current, sessionId, newSession, health, sessions } = useStore();
  const [question, setQuestion] = useState("");
  const [inspect, setInspect] = useState(true);
  const [mode, setMode] = useState<RetrievalMode>("iterative");
  const [maxRounds, setMaxRounds] = useState(3);
  const [queue, setQueue] = useState<{ example: Example; next: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const turns = sessions[sessionId]?.detail?.turns.length ?? 0;
  const canRun = question.trim().length > 0 && !busy && health.api.state !== "down";

  function run() {
    if (!canRun) return;
    void ask(question.trim(), sessionId, inspect ? { mode, maxRounds } : null);
    setQuestion("");
    setQueue((q) => (q && q.next < q.example.questions.length ? q : null));
  }

  function choose(example: Example) {
    // A conversation example starts in a new session, so its follow-ups resolve against its own first question.
    if (example.questions.length > 1) newSession();
    setQuestion(example.questions[0]);
    setQueue(example.questions.length > 1 ? { example, next: 1 } : null);
    input.current?.focus();
  }

  function nextOfExample() {
    if (!queue) return;
    setQuestion(queue.example.questions[queue.next]);
    setQueue({ example: queue.example, next: queue.next + 1 });
    input.current?.focus();
  }

  return (
    <div className="panel composer" data-busy={busy}>
      <textarea
        ref={input}
        className="textarea"
        aria-label="Question"
        placeholder="Ask a question about the policy corpus"
        value={question}
        maxLength={2000}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            run();
          }
        }}
      />
      <div className="composer-bar">
        <div className="group">
        <label title="Questions with the same session id form one conversation: a follow-up is resolved against its earlier turns.">
          Session <Id>{sessionId}</Id>
          <span className="faint">{turns ? `${turns} turn${turns === 1 ? "" : "s"}` : "new"}</span>
        </label>
        <button className="btn small ghost" onClick={() => newSession()} disabled={busy}>
          <Plus aria-hidden /> New session
        </button>
        </div>
        <div className="group end">
        {busy && current && !current.pending ? (
          <span className="muted" role="status" style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
            <span className="spinner" aria-hidden /> Reading the stored turn and inspecting retrieval
          </span>
        ) : null}
        <label title="After the answer, send the resolved query to the retrieval service once more (POST /retrieve) to read its rounds and evidence text. POST /query does not return them.">
          <input type="checkbox" checked={inspect} onChange={(e) => setInspect(e.target.checked)} />
          Inspect retrieval
        </label>
        <select className="select" aria-label="Inspection mode" value={mode} disabled={!inspect} onChange={(e) => setMode(e.target.value as RetrievalMode)}>
          <option value="iterative">iterative</option>
          <option value="single">single</option>
        </select>
        <select
          className="select"
          aria-label="Inspection round budget"
          value={maxRounds}
          disabled={!inspect || mode === "single"}
          onChange={(e) => setMaxRounds(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              max {n} round{n === 1 ? "" : "s"}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={run} disabled={!canRun}>
          Run query <CornerDownLeft aria-hidden />
        </button>
        </div>
      </div>
      {queue && queue.next < queue.example.questions.length ? (
        <div className="examples">
          <span className="faint" style={{ alignSelf: "center", fontSize: 12.5 }}>
            Next question of “{queue.example.label}”:
          </span>
          <button className="example" onClick={nextOfExample} disabled={busy}>
            {queue.example.questions[queue.next]}
          </button>
        </div>
      ) : (
        <div className="examples" aria-label="Example questions from the evaluation material">
          {EXAMPLES.map((example) => (
            <button key={example.source} className="example" onClick={() => choose(example)} title={`${example.source}\n${example.questions.join("\n→ ")}`}>
              {example.label}
              {example.questions.length > 1 ? <span className="faint"> · {example.questions.length} turns</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
