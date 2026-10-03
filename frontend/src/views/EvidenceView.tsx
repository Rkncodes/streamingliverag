// Answer → claim → evidence → source. Claims and their quotes come from the stored turn; the evidence is the list
// of chunks the model was shown; text and source metadata come from the retrieval inspections of the run.

import { EvidencePanel } from "../components/EvidencePanel";
import { CitationList } from "../components/AnswerPanel";
import { Disclosure, EmptyState, Note, Section, StatusBadge, ViewHead } from "../components/ui";
import { evidenceRetrievedOnly, evidenceShown } from "../lib/model";
import { useStore } from "../state/store";
import { RunPicker } from "./RunPicker";

export function EvidenceView() {
  const { run, navigate, highlight, setHighlight, inspect, health } = useStore();
  const r = run?.response;
  if (!run || !r || r.status !== "completed") {
    return (
      <div className="view">
        <ViewHead title="Evidence" actions={<RunPicker />}>
          Where an answer comes from: its claims, the chunks behind them, and their source documents.
        </ViewHead>
        <EmptyState
          title={run ? "This run has no evidence to show" : "No run to show"}
          action={
            <button className="btn" onClick={() => navigate("query")}>
              Go to Query
            </button>
          }
        >
          {run ? "The query is still running, or it failed before any evidence was returned." : "Run a query first."}
        </EmptyState>
      </div>
    );
  }
  const answer = run.turn?.answer ?? null;
  const claims = answer?.claims ?? [];
  const shown = evidenceShown(run);
  const more = evidenceRetrievedOnly(run);
  const withoutText = shown.filter((e) => !e.item).length;
  const unresolved = r.resolution?.kind === "unresolved";
  const multi = answer?.decomposition.multi ?? false;

  return (
    <div className="view">
      <ViewHead title="Evidence" actions={<RunPicker />}>
        Where the answer comes from: its claims, the chunks behind them, and their source documents.
      </ViewHead>
      <div className="two">
        <div>
          <Section title="Question">
            <p style={{ fontSize: 15 }}>{run.question}</p>
          </Section>
          <Section title="Claims" aside={claims.length ? "select a claim to highlight its evidence" : undefined}>
            {claims.length ? (
              <div className="panel rows">
                {claims.map((claim, i) => {
                  const on = claim.citations.length > 0 && claim.citations.every((n) => highlight.includes(n)) && highlight.length === claim.citations.length;
                  return (
                    <button key={i} className={`claim ${on ? "on" : ""}`} onClick={() => setHighlight(on ? [] : claim.citations)} aria-pressed={on}>
                      <span>
                        {claim.text}{" "}
                        {claim.citations.map((n) => (
                          <span key={n} className="marker" style={{ cursor: "inherit" }}>
                            {n}
                          </span>
                        ))}
                      </span>
                      {multi && claim.intents?.length ? (
                        <span className="chips" style={{ marginTop: 6 }}>
                          {claim.intents.map((k) => (
                            <StatusBadge key={k} plain>
                              intent {k + 1}
                            </StatusBadge>
                          ))}
                        </span>
                      ) : null}
                      {(claim.quotes ?? []).map((quote, j) => (
                        <q key={j}>{quote}</q>
                      ))}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="muted">
                {unresolved
                  ? "The turn was not run, so there are no claims."
                  : r.answer_status === "abstained"
                    ? "The system abstained: it made no claims."
                    : run.turnError
                      ? `The claims are in the stored turn, which could not be read: ${run.turnError}`
                      : answer
                        ? "The stored answer has no verified claims."
                        : "Reading the stored turn."}
              </p>
            )}
            {claims.length ? (
              <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                Each claim was checked by the verifier against the quoted source text before the answer was returned.
              </p>
            ) : null}
          </Section>
          {r.citations.length ? (
            <Section title="Citations">
              <CitationList citations={r.citations} />
            </Section>
          ) : null}
        </div>
        <div>
          <Section title={`Evidence shown to the model (${shown.length})`} aside="in the order of the query response">
            {withoutText > 0 && !unresolved ? (
              <div style={{ marginBottom: 10 }}>
                <Note>
                  The query response lists chunk ids only. {withoutText} of {shown.length} chunks have no text here yet.{" "}
                  {r.resolution?.query && !run.inspections["question"] ? (
                    <button
                      className="btn small"
                      style={{ marginLeft: 6 }}
                      disabled={health.retrieval.state === "down"}
                      onClick={() => void inspect(run.id, "question", "Whole question", r.resolution!.query, { mode: "iterative", maxRounds: 3 })}
                    >
                      Inspect retrieval to load text
                    </button>
                  ) : (
                    "A chunk retrieved only for one intent appears once that intent is inspected in the Execution view."
                  )}
                </Note>
              </div>
            ) : null}
            {shown.length ? (
              <div className="panel">
                <EvidencePanel entries={shown} />
              </div>
            ) : (
              <p className="muted">{unresolved ? "Nothing was retrieved for this turn." : "No chunk was shown to the model."}</p>
            )}
          </Section>
          {more.length ? (
            <Section title="Retrieved, not shown">
              <Disclosure summary={`${more.length} chunks the retrieval inspections returned that the model was not shown`}>
                <div className="panel" style={{ marginTop: 6 }}>
                  <EvidencePanel entries={more} />
                </div>
              </Disclosure>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
