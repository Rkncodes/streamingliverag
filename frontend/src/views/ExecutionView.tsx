import { ExecutionPipeline } from "../components/ExecutionPipeline";
import { EmptyState, ViewHead } from "../components/ui";
import { useStore } from "../state/store";
import { RunPicker } from "./RunPicker";

export function ExecutionView() {
  const { run, navigate } = useStore();
  return (
    <div className="view">
      <ViewHead title="Execution" actions={<RunPicker />}>
        What the pipeline did for one query, stage by stage, from the responses of the backend.
      </ViewHead>
      {run ? (
        <ExecutionPipeline run={run} />
      ) : (
        <EmptyState
          title="No run to show"
          action={
            <button className="btn" onClick={() => navigate("query")}>
              Go to Query
            </button>
          }
        >
          Run a query first. Its pipeline appears here.
        </EmptyState>
      )}
    </div>
  );
}
