// Evidence inspection: the chunks the model was shown, each with its source, its text (when a retrieval inspection
// returned it), and the facts the backend recorded about it: context label, citations, intent ranks and scores,
// retrieval round. Provenance fields come from the chunk's own metadata.

import type { Chunk } from "../api/types";
import { pagesOf, score, type EvidenceEntry } from "../lib/model";
import { useStore } from "../state/store";
import { Disclosure, Id, MetricRow, Metrics, StatusBadge } from "./ui";

/** The document a chunk comes from: every field is chunk metadata from the retrieval service. */
export function DocumentSource({ chunk }: { chunk: Chunk }) {
  return (
    <Metrics>
      <MetricRow label="Document">{chunk.title}</MetricRow>
      <MetricRow label="Organization">{chunk.organization}</MetricRow>
      <MetricRow label="Location">
        {[pagesOf(chunk.page_start, chunk.page_end), chunk.section_path.join(" › ") || null, chunk.clause_id ? `clause ${chunk.clause_id}` : null]
          .filter(Boolean)
          .join(" · ")}
      </MetricRow>
      <MetricRow label="Version">{chunk.version}</MetricRow>
      <MetricRow label="Effective date">{chunk.effective_date}</MetricRow>
      <MetricRow label="Superseded date">{chunk.superseded_date}</MetricRow>
      <MetricRow label="Current">{chunk.is_current == null ? null : chunk.is_current ? "yes" : "no"}</MetricRow>
      <MetricRow label="Type">{[chunk.document_type, chunk.domain].filter(Boolean).join(" · ")}</MetricRow>
      <MetricRow label="Series" mono>
        {chunk.series_id}
      </MetricRow>
      <MetricRow label="Document id" mono>
        {chunk.doc_id}
      </MetricRow>
      <MetricRow label="Chunk id" mono>
        {chunk.chunk_id}
      </MetricRow>
      <MetricRow label="Source URL">
        {chunk.source_url ? (
          <a href={chunk.source_url} target="_blank" rel="noreferrer">
            {chunk.source_url}
          </a>
        ) : null}
      </MetricRow>
      <MetricRow label="Content hash" mono>
        {chunk.content_hash}
      </MetricRow>
    </Metrics>
  );
}

export function EvidenceCard({ entry, compact }: { entry: EvidenceEntry; compact?: boolean }) {
  const { highlight } = useStore();
  const chunk = entry.item?.chunk ?? null;
  const cited = entry.citations[0] ?? null;
  const on = entry.citations.some((c) => highlight.includes(c.number));
  const title = chunk?.title ?? cited?.document ?? null;
  const where = chunk
    ? [chunk.organization, pagesOf(chunk.page_start, chunk.page_end), chunk.section_path[chunk.section_path.length - 1], chunk.clause_id ? `clause ${chunk.clause_id}` : null]
    : cited
      ? [cited.organization, cited.pages || null, cited.section, cited.clause ? `clause ${cited.clause}` : null]
      : [];
  return (
    <article className={`evidence-card ${on ? "on" : ""}`} id={`chunk-${entry.chunkId}`}>
      <header>
        {entry.label ? <span className="mono faint">{entry.label}</span> : null}
        <span className="title">{title ?? <Id>{entry.chunkId}</Id>}</span>
        {entry.citations.map((c) => (
          <StatusBadge key={c.number} tone="ok" plain>
            cited [{c.number}]
          </StatusBadge>
        ))}
        {entry.promoted ? (
          <span title="The retrieval loop moved this chunk into the context to cover an organization the question names.">
            <StatusBadge tone="info" plain>
              promoted
            </StatusBadge>
          </span>
        ) : null}
      </header>
      <div className="where">{where.filter(Boolean).join(" · ") || <span className="faint">Source not loaded: the query response carries the chunk id only.</span>}</div>
      {compact ? null : chunk ? (
        <div className="text">{chunk.text}</div>
      ) : (
        <div className="text unavailable">
          The query API returns only this chunk's id. Its text appears here once a retrieval inspection has returned the chunk.
        </div>
      )}
      <div className="chips">
        {entry.item ? <StatusBadge plain>retrieval rank {entry.item.rank}</StatusBadge> : null}
        {entry.item?.rerank_score != null ? (
          <span title="Cross-encoder score of this chunk for the inspected query">
            <StatusBadge plain>rerank {score(entry.item.rerank_score)}</StatusBadge>
          </span>
        ) : null}
        {entry.firstRound != null ? <StatusBadge plain>first retrieved in round {entry.firstRound}</StatusBadge> : null}
        {entry.intents.map((i) => (
          <span key={i.intent} title="Rank and cross-encoder score of this chunk in the retrieval the orchestrator made (from the stored turn)">
            <StatusBadge plain>
              {entry.multi ? `intent ${i.intent + 1}: ` : ""}rank {i.rank}, relevance {score(i.score)}
            </StatusBadge>
          </span>
        ))}
      </div>
      {compact ? null : (
        <Disclosure summary={chunk ? "Source and provenance" : "Identifiers"}>
          {chunk ? (
            <DocumentSource chunk={chunk} />
          ) : (
            <Metrics>
              <MetricRow label="Chunk id" mono>
                {entry.chunkId}
              </MetricRow>
              <MetricRow label="Document id" mono>
                {cited?.doc_id}
              </MetricRow>
            </Metrics>
          )}
          {entry.itemFrom ? <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>Text and metadata from the retrieval inspection “{entry.itemFrom}”.</p> : null}
        </Disclosure>
      )}
    </article>
  );
}

export function EvidencePanel({ entries, compact }: { entries: EvidenceEntry[]; compact?: boolean }) {
  return (
    <div className="rows">
      {entries.map((entry) => (
        <EvidenceCard key={entry.chunkId} entry={entry} compact={compact} />
      ))}
    </div>
  );
}
