// A stored session (GET /sessions/{id}) as a timeline of turns: what was asked, how it was resolved against earlier
// turns, what the pipeline received, and how it ended.

import type { SessionDetail, TurnDetail } from "../api/types";
import { words } from "../lib/model";
import { Id, Raw, StatusBadge } from "./ui";

function Turn({ turn }: { turn: TurnDetail }) {
  const res = turn.resolution;
  const rewritten = res.query && res.query !== turn.question;
  const intents = turn.answer ? (turn.answer.decomposition.multi ? turn.answer.decomposition.intents.length : 1) : 0;
  return (
    <div className="turn">
      <span className="dot" aria-hidden>
        {turn.index}
      </span>
      <h3>{turn.question}</h3>
      <div className="chips" style={{ marginTop: 6 }}>
        <StatusBadge tone={res.kind === "follow_up" ? "info" : res.kind === "unresolved" ? "warn" : "neutral"}>{words(res.kind)}</StatusBadge>
        <StatusBadge tone={turn.status === "answered" ? "ok" : "warn"}>{turn.status}</StatusBadge>
        {res.anchor != null ? <StatusBadge plain>{res.kind === "unresolved" ? "refers to" : "resolved against"} turn {res.anchor}</StatusBadge> : null}
        {res.temporal ? <StatusBadge plain>temporal: {res.temporal}</StatusBadge> : null}
        {turn.answer ? <StatusBadge plain>{turn.answer.strategy.replace(/_/g, " ")}</StatusBadge> : null}
        {intents > 1 ? <StatusBadge plain>{intents} intents</StatusBadge> : null}
        {turn.answer ? <StatusBadge plain>{turn.answer.citations.length} citations</StatusBadge> : null}
        {turn.reused_citations.length ? (
          <span title="Chunks this turn cites that the turn it was resolved against cited as well">
            <StatusBadge plain>{turn.reused_citations.length} reused</StatusBadge>
          </span>
        ) : null}
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        {res.reason}
      </p>
      {rewritten ? (
        <div className="rewrite">
          <div className="k">Earlier context → resolved query</div>
          {res.query}
        </div>
      ) : null}
      {res.kind === "unresolved" ? (
        <div className="rewrite">
          <div className="k">Not run</div>
          No retrieval and no model call: the reference could not be resolved safely.
        </div>
      ) : null}
      {turn.status === "answered" ? (
        <p style={{ marginTop: 8, maxWidth: "76ch", whiteSpace: "pre-wrap" }}>{turn.text}</p>
      ) : turn.answer?.abstention_reason ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Abstained: <Id>{turn.answer.abstention_reason}</Id>
        </p>
      ) : null}
      <Raw label="Stored resolution" value={res} />
    </div>
  );
}

export function SessionTimeline({ session }: { session: SessionDetail }) {
  return (
    <div className="timeline">
      {session.turns.map((turn) => (
        <Turn key={turn.index} turn={turn} />
      ))}
    </div>
  );
}
