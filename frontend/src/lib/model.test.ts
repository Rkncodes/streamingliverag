import { describe, expect, it } from "vitest";
import type { Citation, QueryResponse, RetrievalResponse, TurnDetail } from "../api/types";
import { abstentionTitle, evidenceRetrievedOnly, evidenceShown, segments, words, type Run } from "./model";
import { newTraceparent, parseTraceHeader } from "./trace";

const cite = (number: number, chunk_id: string): Citation => ({
  number,
  label: `S${number}`,
  chunk_id,
  doc_id: "d",
  organization: "Org",
  document: "Doc",
  effective_date: null,
  pages: "3",
  section: null,
  clause: null,
});

describe("segments", () => {
  it("splits text at citation markers and keeps only markers that are citations", () => {
    const out = segments("Due in 30 days [1]. See [2, 1] and [9] and [x].", [cite(1, "a"), cite(2, "b")]);
    expect(out.filter((s) => s.kind === "marker").map((s) => (s as { number: number }).number)).toEqual([1, 2, 1]);
    expect(out.map((s) => (s.kind === "text" ? s.text : `<${s.number}>`)).join("")).toBe("Due in 30 days <1>. See <2><1> and [9] and [x].");
  });

  it("returns the text unchanged when there are no citations", () => {
    expect(segments("No sources [1].", [])).toEqual([{ kind: "text", text: "No sources [1]." }]);
  });
});

describe("trace context", () => {
  it("makes a valid, random traceparent", () => {
    const a = newTraceparent();
    const b = newTraceparent();
    expect(a).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(a).not.toBe(b);
    expect(parseTraceHeader(a)).toEqual({ traceId: a.split("-")[1], spanId: a.split("-")[2] });
  });

  it("rejects anything that is not a trace header", () => {
    for (const bad of [null, undefined, "", "abc", "00-xyz-123-01", "00-" + "0".repeat(31) + "-" + "0".repeat(16) + "-01"]) {
      expect(parseTraceHeader(bad)).toBeNull();
    }
  });
});

describe("evidence view model", () => {
  const response = { evidence: ["a", "b"], citations: [cite(1, "b")] } as unknown as QueryResponse;
  const turn = {
    answer: {
      evidence_intents: { a: [{ intent: 0, rank: 1, score: 2 }] },
      phase1: [{ sources_considered: [{ label: "S1", chunk_id: "a" }, { label: "S2", chunk_id: "b" }] }],
    },
  } as unknown as TurnDetail;
  const result = {
    evidence: [
      { chunk: { chunk_id: "b", text: "text of b" }, rank: 1, score: 1, retriever: "r", rerank_score: 1 },
      { chunk: { chunk_id: "c", text: "text of c" }, rank: 2, score: 0, retriever: "r", rerank_score: 0 },
    ],
    trace: { rounds: [{ iteration: 1, new: ["c"], promoted: [] }, { iteration: 2, new: ["b"], promoted: ["b"] }] },
  } as unknown as RetrievalResponse;
  const run: Run = {
    id: "1",
    question: "q",
    sessionId: "s",
    requestId: "r",
    startedAt: "2026-01-01T00:00:00Z",
    pending: false,
    response,
    turn,
    inspections: { question: { key: "question", label: "Whole question", request: { query: "q", mode: "iterative", max_rounds: 3, k: 10 }, pending: false, result } },
  };

  it("lists exactly the chunks of the query response, in its order, and never invents text", () => {
    const shown = evidenceShown(run);
    expect(shown.map((e) => e.chunkId)).toEqual(["a", "b"]);
    expect(shown[0]).toMatchObject({ label: "S1", item: null, firstRound: null, promoted: false, citations: [] });
    expect(shown[0].intents).toEqual([{ intent: 0, rank: 1, score: 2 }]);
    expect(shown[1]).toMatchObject({ label: "S2", firstRound: 2, promoted: true, itemFrom: "Whole question" });
    expect(shown[1].item?.chunk.text).toBe("text of b");
    expect(shown[1].citations.map((c) => c.number)).toEqual([1]);
  });

  it("separates chunks that were retrieved but not shown", () => {
    expect(evidenceRetrievedOnly(run).map((e) => [e.chunkId, e.firstRound])).toEqual([["c", 1]]);
  });

  it("has nothing to show for a run without a response", () => {
    expect(evidenceShown({ ...run, response: undefined })).toEqual([]);
  });
});

describe("codes", () => {
  it("shows an unknown code as it is and never hides one", () => {
    expect(words("some_new_code")).toBe("some new code");
    expect(words(null)).toBe("—");
    expect(abstentionTitle("provider_error")).toBe("Model provider error");
    expect(abstentionTitle("model_insufficient_evidence")).toBe("Insufficient evidence");
    expect(abstentionTitle("unresolved_reference")).toBe("Unresolved reference");
  });
});
