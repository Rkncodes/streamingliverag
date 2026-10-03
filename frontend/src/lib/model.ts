// Pure view-model helpers: they only rearrange what the backend returned. No value is computed that the backend did
// not send, apart from counts of lists it sent.

import type { Exchange } from "../api/client";
import type {
  Citation,
  EvidenceItem,
  QueryResponse,
  RetrievalRequest,
  RetrievalResponse,
  TurnDetail,
} from "../api/types";

export interface Inspection {
  key: string; // "question" or "intent-<n>"
  label: string;
  request: RetrievalRequest;
  pending: boolean;
  result?: RetrievalResponse;
  exchange?: Exchange;
  error?: string;
}

export interface Run {
  id: string;
  question: string;
  sessionId: string;
  requestId: string;
  startedAt: string;
  pending: boolean;
  response?: QueryResponse;
  exchange?: Exchange;
  error?: string;
  /** The stored turn (GET /sessions/{id}), fetched after the answer: undefined until loaded. */
  turn?: TurnDetail;
  turnExchange?: Exchange;
  turnError?: string;
  inspections: Record<string, Inspection>;
}

/** The orchestrator asks the retrieval service for this many chunks (generation.pipeline.RETRIEVE_K). */
export const ORCHESTRATOR_K = 10;

// ---- the answer text and its [n] markers

export type Segment = { kind: "text"; text: string } | { kind: "marker"; number: number };

/** Split answer text at its citation markers, "[1]" or "[1, 2]", keeping only numbers that are citations. */
export function segments(text: string, citations: Citation[]): Segment[] {
  const known = new Set(citations.map((c) => c.number));
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    const numbers = match[1].split(",").map((n) => Number(n.trim()));
    if (!numbers.every((n) => known.has(n))) continue;
    if (match.index! > last) out.push({ kind: "text", text: text.slice(last, match.index) });
    for (const number of numbers) out.push({ kind: "marker", number });
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

// ---- evidence

export interface EvidenceEntry {
  chunkId: string;
  shownToModel: boolean;
  label: string | null; // the context label the model saw (S1, S2, ...), from the stored turn
  citations: Citation[]; // citations of the answer that point at this chunk
  intents: { intent: number; rank: number; score: number | null }[]; // per intent: rank and cross-encoder score
  multi: boolean; // the question was split into several intents
  item: EvidenceItem | null; // the chunk with its text, when a retrieval inspection returned it
  itemFrom: string | null; // which inspection
  firstRound: number | null; // the round of that inspection's trace that first retrieved it
  promoted: boolean; // moved into the context by that trace to close an organization gap
}

export function inspectionsOf(run: Run): Inspection[] {
  return Object.values(run.inspections).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

function locate(run: Run, chunkId: string) {
  for (const inspection of inspectionsOf(run)) {
    const item = inspection.result?.evidence.find((e) => e.chunk.chunk_id === chunkId);
    if (!item) continue;
    const rounds = inspection.result?.trace?.rounds ?? [];
    const first = rounds.find((r) => r.new.includes(chunkId));
    return {
      item,
      itemFrom: inspection.label,
      firstRound: first ? first.iteration : null,
      promoted: rounds.some((r) => r.promoted.includes(chunkId)),
    };
  }
  return { item: null, itemFrom: null, firstRound: null, promoted: false };
}

/** The chunks the model was shown for this answer (QueryResponse.evidence), joined with everything known about each. */
export function evidenceShown(run: Run): EvidenceEntry[] {
  const response = run.response;
  if (!response) return [];
  const answer = run.turn?.answer ?? null;
  const labels = new Map<string, string>();
  for (const part of answer?.phase1 ?? []) for (const s of part.sources_considered ?? []) if (!labels.has(s.chunk_id)) labels.set(s.chunk_id, s.label);
  return response.evidence.map((chunkId) => ({
    chunkId,
    shownToModel: true,
    label: labels.get(chunkId) ?? null,
    citations: response.citations.filter((c) => c.chunk_id === chunkId),
    intents: answer?.evidence_intents?.[chunkId] ?? [],
    multi: answer?.decomposition?.multi ?? false,
    ...locate(run, chunkId),
  }));
}

/** Chunks an inspection retrieved that the model was not shown. */
export function evidenceRetrievedOnly(run: Run): EvidenceEntry[] {
  const shown = new Set(run.response?.evidence ?? []);
  const seen = new Set<string>();
  const out: EvidenceEntry[] = [];
  for (const inspection of inspectionsOf(run)) {
    for (const e of inspection.result?.evidence ?? []) {
      const id = e.chunk.chunk_id;
      if (shown.has(id) || seen.has(id)) continue;
      seen.add(id);
      const answer = run.turn?.answer;
      out.push({ chunkId: id, shownToModel: false, label: null, citations: [], intents: answer?.evidence_intents?.[id] ?? [], multi: answer?.decomposition?.multi ?? false, ...locate(run, id) });
    }
  }
  return out;
}

// ---- formatting

export function ms(value: number | null | undefined): string {
  if (value == null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

export function seconds(value: number): string {
  return value >= 1 ? `${value.toFixed(2)} s` : `${(value * 1000).toFixed(1)} ms`;
}

export function score(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(3);
}

export function pagesOf(pageStart: number, pageEnd: number): string {
  return pageStart === pageEnd ? `p. ${pageStart}` : `pp. ${pageStart}–${pageEnd}`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

/** Human words for the backend's codes; an unknown code is shown as it is. */
const WORDS: Record<string, string> = {
  model_insufficient_evidence: "The model found the retrieved evidence insufficient",
  low_relevance: "No retrieved source was relevant enough to show the model",
  no_evidence: "Nothing was retrieved",
  ungrounded_output: "The model's output could not be verified against the sources",
  provider_error: "The model provider failed",
  unresolved_reference: "The question refers to earlier context that could not be resolved",
  self_contained: "Self-contained",
  follow_up: "Follow-up",
  unresolved: "Unresolved",
  delegate: "Delegated to the single-question path",
  fused: "Evidence of the intents fused into one answer",
  per_intent: "Each intent answered separately",
  no_supported_intent: "No intent could be supported",
  single: "One answer",
  split_by_version: "Split by document version",
};

/** The heading of an abstention, by the backend's abstention_reason code. */
export function abstentionTitle(reason: string | null | undefined): string {
  if (reason === "unresolved_reference") return "Unresolved reference";
  if (reason === "provider_error") return "Model provider error";
  if (reason === "ungrounded_output") return "Answer rejected by the verifier";
  return "Insufficient evidence";
}

export function words(code: string | null | undefined): string {
  if (!code) return "—";
  return WORDS[code] ?? code.replace(/_/g, " ");
}
