// Which run the Execution, Evidence and Telemetry views show.

import { useStore } from "../state/store";

export function RunPicker() {
  const { runs, run, selectRun } = useStore();
  if (runs.length < 2 || !run) return null;
  return (
    <select className="select" aria-label="Run" value={run.id} onChange={(e) => selectRun(e.target.value)} style={{ maxWidth: 420 }}>
      {[...runs].reverse().map((r) => (
        <option key={r.id} value={r.id}>
          {r.question.length > 64 ? `${r.question.slice(0, 64)}…` : r.question}
        </option>
      ))}
    </select>
  );
}
