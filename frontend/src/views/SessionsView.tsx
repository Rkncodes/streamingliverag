// Conversations stored by the backend. The list holds the session ids this browser started (kept locally); the
// content of a session always comes from GET /sessions/{id}.

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { SessionTimeline } from "../components/SessionTimeline";
import { EmptyState, ErrorState, Id, Pending, Section, ViewHead } from "../components/ui";
import { useStore } from "../state/store";

export function SessionsView() {
  const { knownSessions, sessions, loadSession, sessionId, setSessionId, navigate } = useStore();
  const [open, setOpen] = useState<string>(() => (knownSessions.includes(sessionId) ? sessionId : (knownSessions[0] ?? "")));
  const [lookup, setLookup] = useState("");
  const entry = open ? sessions[open] : undefined;

  useEffect(() => {
    if (open) void loadSession(open);
  }, [open, loadSession]);

  const valid = /^[A-Za-z0-9_.:-]{1,128}$/.test(lookup);

  return (
    <div className="view">
      <ViewHead title="Sessions">
        A session is a conversation: each follow-up is resolved against its earlier turns, and the result is stored by the orchestrator.
      </ViewHead>
      <div className="two" style={{ gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)" }}>
        <div>
          <Section title="Sessions started in this browser">
            {knownSessions.length ? (
              <div className="panel run-list rows">
                {knownSessions.map((id) => (
                  <button key={id} className={id === open ? "on" : ""} onClick={() => setOpen(id)}>
                    <span className="q mono">{id}</span>
                    <span className="faint" style={{ fontSize: 11.5 }}>
                      {sessions[id]?.detail ? `${sessions[id]!.detail!.turns.length} turns` : ""}
                    </span>
                    {id === sessionId ? <span className="meta">the composer continues this session</span> : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">None yet. A session appears here after its first answered query.</p>
            )}
          </Section>
          <Section title="Open a session by id">
            <form
              style={{ display: "flex", gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) setOpen(lookup);
              }}
            >
              <input className="input mono" aria-label="Session id" placeholder="session id" value={lookup} onChange={(e) => setLookup(e.target.value.trim())} />
              <button className="btn" disabled={!valid}>
                Open
              </button>
            </form>
          </Section>
        </div>
        <div>
          {!open ? (
            <EmptyState
              title="No session selected"
              action={
                <button className="btn" onClick={() => navigate("query")}>
                  Go to Query
                </button>
              }
            >
              Ask a question, then a follow-up such as “Does that apply currently?”, and come back.
            </EmptyState>
          ) : (
            <Section
              title="Conversation"
              aside={
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <Id>{open}</Id>
                  <button className="btn small ghost" onClick={() => void loadSession(open)} title="Read the session again">
                    <RefreshCw aria-hidden /> Reload
                  </button>
                  <button
                    className="btn small"
                    disabled={!entry?.detail}
                    onClick={() => {
                      setSessionId(open);
                      navigate("query");
                    }}
                  >
                    Continue in Query
                  </button>
                </span>
              }
            >
              {entry?.detail ? (
                <SessionTimeline session={entry.detail} />
              ) : entry?.notFound ? (
                <EmptyState title="The backend has no session with this id">It was never answered, or the session store no longer holds it.</EmptyState>
              ) : entry?.error ? (
                <ErrorState title="The session could not be read">{entry.error}</ErrorState>
              ) : (
                <Pending>
                  Reading <span className="mono">GET /sessions/{open}</span>
                </Pending>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
