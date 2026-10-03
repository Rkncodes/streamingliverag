// The application frame: top bar (identity, backend state, theme), sidebar navigation, and the workspace.

import { Activity, FileText, History, LayoutDashboard, Moon, Network, RefreshCw, Search, Sun, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { SERVICES, useStore, type View } from "../state/store";
import { StatusBadge, type Tone } from "./ui";

const NAV: { view: View; label: string; icon: typeof Search }[] = [
  { view: "overview", label: "Overview", icon: LayoutDashboard },
  { view: "query", label: "Query", icon: Search },
  { view: "execution", label: "Execution", icon: Workflow },
  { view: "evidence", label: "Evidence", icon: FileText },
  { view: "sessions", label: "Sessions", icon: History },
  { view: "telemetry", label: "Telemetry", icon: Activity },
  { view: "architecture", label: "Architecture", icon: Network },
];

/** One line about the backend, from the four /health answers only. */
function BackendStatus() {
  const { health } = useStore();
  const states = SERVICES.map((s) => health[s].state);
  const up = states.filter((s) => s === "ok").length;
  let tone: Tone = "ok";
  let text = "All services reachable";
  if (states.every((s) => s === "checking")) {
    tone = "neutral";
    text = "Checking services";
  } else if (health.api.state === "down") {
    tone = "err";
    text = "API unreachable";
  } else if (up < SERVICES.length) {
    tone = "warn";
    text = `${up} of ${SERVICES.length} services reachable`;
  }
  const generation = health.generation.health;
  return (
    <>
      <StatusBadge tone={tone}>{text}</StatusBadge>
      {generation ? (
        generation.provider === "offline-stub" ? (
          <span title="The generation service runs its stub model (GENERATION_PROVIDER=offline): every answer is an abstention.">
            <StatusBadge tone="warn">Stub model: answers abstain</StatusBadge>
          </span>
        ) : (
          <StatusBadge plain>
            model <span className="mono">{generation.model ?? generation.provider}</span>
          </StatusBadge>
        )
      ) : null}
    </>
  );
}

export function TopBar() {
  const { theme, toggleTheme, checkHealth } = useStore();
  return (
    <header className="topbar">
      <div className="brand">
        <strong>StreamingLiveRAG</strong>
        <span>AdaptiveRAG</span>
      </div>
      <BackendStatus />
      <div className="spacer" />
      <button className="icon-btn" onClick={checkHealth} title="Check the services again" aria-label="Check the services again">
        <RefreshCw aria-hidden />
      </button>
      <button
        className="icon-btn"
        onClick={toggleTheme}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      >
        {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
      </button>
    </header>
  );
}

export function Sidebar() {
  const { view, navigate, runs, knownSessions } = useStore();
  const counts: Partial<Record<View, number>> = { query: runs.length, sessions: knownSessions.length };
  return (
    <nav className="sidebar" aria-label="Views">
      <div className="nav-label">Workspace</div>
      {NAV.map(({ view: target, label, icon: Icon }) => (
        <button
          key={target}
          className="nav-item"
          aria-current={view === target ? "page" : undefined}
          onClick={() => navigate(target)}
          title={label}
        >
          <Icon aria-hidden />
          <span>{label}</span>
          {counts[target] ? <span className="count">{counts[target]}</span> : null}
        </button>
      ))}
      <div className="foot">Every value on these pages comes from a backend response. Nothing is simulated.</div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <TopBar />
      <Sidebar />
      <main className="main">{children}</main>
    </div>
  );
}
