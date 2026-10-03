import { AppShell } from "./components/AppShell";
import { StoreProvider, useStore, type View } from "./state/store";
import { ArchitectureView } from "./views/ArchitectureView";
import { EvidenceView } from "./views/EvidenceView";
import { ExecutionView } from "./views/ExecutionView";
import { OverviewView } from "./views/OverviewView";
import { QueryView } from "./views/QueryView";
import { SessionsView } from "./views/SessionsView";
import { TelemetryView } from "./views/TelemetryView";

const VIEW: Record<View, () => JSX.Element> = {
  overview: OverviewView,
  query: QueryView,
  execution: ExecutionView,
  evidence: EvidenceView,
  sessions: SessionsView,
  telemetry: TelemetryView,
  architecture: ArchitectureView,
};

function Workspace() {
  const { view } = useStore();
  const Current = VIEW[view];
  return <Current />;
}

export function App() {
  return (
    <StoreProvider>
      <AppShell>
        <Workspace />
      </AppShell>
    </StoreProvider>
  );
}
