// Application state: the runs made in this browser tab, the services' health, the sessions this browser started,
// the theme and the current view. Everything about a run comes from the backend's responses; this module only
// sequences the requests (query, then the stored turn, then an optional retrieval inspection).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, backend, type Exchange } from "../api/client";
import type { Health, RetrievalMode, ServiceName, SessionDetail } from "../api/types";
import { ORCHESTRATOR_K, type Inspection, type Run } from "../lib/model";

export type View = "overview" | "query" | "execution" | "evidence" | "sessions" | "telemetry" | "architecture";
export const VIEWS: View[] = ["overview", "query", "execution", "evidence", "sessions", "telemetry", "architecture"];
export const SERVICES: ServiceName[] = ["api", "retrieval", "generation", "mcp"];

export interface ServiceHealth {
  state: "checking" | "ok" | "down";
  health?: Health;
  error?: string;
  ms?: number;
  checkedAt?: string;
}

export interface InspectOptions {
  mode: RetrievalMode;
  maxRounds: number;
}

interface SessionEntry {
  loading: boolean;
  detail?: SessionDetail;
  error?: string;
  notFound?: boolean;
}

interface Store {
  view: View;
  navigate: (view: View) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  health: Record<ServiceName, ServiceHealth>;
  checkHealth: () => void;
  runs: Run[];
  run: Run | null; // the selected run
  selectRun: (id: string) => void;
  busy: boolean; // a query and its follow-up requests are in flight (the api handles one query at a time)
  ask: (question: string, sessionId: string, inspect: InspectOptions | null) => Promise<void>;
  inspect: (runId: string, key: string, label: string, query: string, options: InspectOptions) => Promise<void>;
  sessionId: string; // the session the composer continues
  setSessionId: (id: string) => void;
  newSession: () => string;
  knownSessions: string[];
  sessions: Record<string, SessionEntry>;
  loadSession: (id: string) => Promise<void>;
  exchanges: Exchange[]; // every traced request this tab made, newest last
  highlight: number[]; // citation numbers selected in the answer, a claim or the citation list
  setHighlight: (numbers: number[]) => void;
}

const Context = createContext<Store | null>(null);

function token(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function freshSessionId(): string {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `demo-${day}-${token()}`;
}

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app works without it */
  }
}

function viewFromHash(): View {
  const name = window.location.hash.replace(/^#\/?/, "") as View;
  return VIEWS.includes(name) ? name : "overview";
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : String((error as Error)?.message ?? error);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [health, setHealth] = useState<Record<ServiceName, ServiceHealth>>(
    () => Object.fromEntries(SERVICES.map((s) => [s, { state: "checking" }])) as Record<ServiceName, ServiceHealth>,
  );
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [knownSessions, setKnownSessions] = useState<string[]>(() => stored<string[]>("slr.sessions", []));
  const [sessionId, setSessionIdState] = useState<string>(() => stored<string>("slr.session", "") || freshSessionId());
  const [sessions, setSessions] = useState<Record<string, SessionEntry>>({});
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<number[]>([]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((next: View) => {
    window.location.hash = `/${next}`;
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("slr.theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const record = useCallback((exchange: Exchange) => setExchanges((all) => [...all, exchange]), []);
  const patchRun = useCallback((id: string, patch: (run: Run) => Run) => {
    setRuns((all) => all.map((r) => (r.id === id ? patch(r) : r)));
  }, []);

  const checkHealth = useCallback(() => {
    for (const service of SERVICES) {
      setHealth((h) => ({ ...h, [service]: { ...h[service], state: "checking" } }));
      backend
        .health(service)
        .then(({ data, exchange }) => {
          // Another program may answer on the port: only the service that names itself counts.
          const ok = data?.status === "ok" && data?.service === service;
          setHealth((h) => ({
            ...h,
            [service]: ok
              ? { state: "ok", health: data, ms: exchange.ms, checkedAt: exchange.startedAt }
              : { state: "down", error: "Something else answered on this address.", checkedAt: exchange.startedAt },
          }));
        })
        .catch((error) =>
          setHealth((h) => ({ ...h, [service]: { state: "down", error: message(error), checkedAt: new Date().toISOString() } })),
        );
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const timer = window.setInterval(checkHealth, 30_000);
    return () => window.clearInterval(timer);
  }, [checkHealth]);

  const setSessionId = useCallback((id: string) => {
    setSessionIdState(id);
    persist("slr.session", id);
  }, []);

  const newSession = useCallback(() => {
    const id = freshSessionId();
    setSessionId(id);
    return id;
  }, [setSessionId]);

  const remember = useCallback((id: string) => {
    setKnownSessions((all) => {
      if (all.includes(id)) return all;
      const next = [id, ...all].slice(0, 30);
      persist("slr.sessions", next);
      return next;
    });
  }, []);

  const loadSession = useCallback(
    async (id: string) => {
      setSessions((all) => ({ ...all, [id]: { ...all[id], loading: true, error: undefined } }));
      try {
        const { data, exchange } = await backend.session(id);
        record(exchange);
        setSessions((all) => ({ ...all, [id]: { loading: false, detail: data } }));
      } catch (error) {
        if (error instanceof ApiError) record(error.exchange);
        const notFound = error instanceof ApiError && error.exchange.status === 404;
        setSessions((all) => ({ ...all, [id]: { loading: false, notFound, error: notFound ? undefined : message(error) } }));
      }
    },
    [record],
  );

  const inspect = useCallback(
    async (runId: string, key: string, label: string, query: string, options: InspectOptions) => {
      const request = {
        query,
        mode: options.mode,
        max_rounds: options.maxRounds,
        k: ORCHESTRATOR_K,
        request_id: `ui-inspect-${token()}`,
      };
      const start: Inspection = { key, label, request, pending: true };
      patchRun(runId, (r) => ({ ...r, inspections: { ...r.inspections, [key]: start } }));
      try {
        const { data, exchange } = await backend.retrieve(request);
        record(exchange);
        patchRun(runId, (r) => ({ ...r, inspections: { ...r.inspections, [key]: { ...start, pending: false, result: data, exchange } } }));
      } catch (error) {
        const exchange = error instanceof ApiError ? error.exchange : undefined;
        if (exchange) record(exchange);
        patchRun(runId, (r) => ({ ...r, inspections: { ...r.inspections, [key]: { ...start, pending: false, exchange, error: message(error) } } }));
      }
    },
    [patchRun, record],
  );

  const ask = useCallback(
    async (question: string, session: string, inspectOptions: InspectOptions | null) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      const id = token(10);
      const requestId = `ui-${id}`;
      const run: Run = { id, question, sessionId: session, requestId, startedAt: new Date().toISOString(), pending: true, inspections: {} };
      setRuns((all) => [...all, run]);
      setSelected(id);
      try {
        const { data, exchange } = await backend.query({ session_id: session, question, request_id: requestId });
        record(exchange);
        patchRun(id, (r) => ({ ...r, pending: false, response: data, exchange }));
        if (data.status !== "completed" || data.turn_index == null) return;
        remember(session);
        // The stored turn: the decomposition, per-intent results and claims that POST /query only summarises.
        try {
          const stored = await backend.session(session);
          record(stored.exchange);
          setSessions((all) => ({ ...all, [session]: { loading: false, detail: stored.data } }));
          const turn = stored.data.turns[data.turn_index];
          patchRun(id, (r) => (turn ? { ...r, turn, turnExchange: stored.exchange } : { ...r, turnExchange: stored.exchange, turnError: `The stored session has no turn ${data.turn_index}.` }));
        } catch (error) {
          if (error instanceof ApiError) record(error.exchange);
          patchRun(id, (r) => ({ ...r, turnError: message(error) }));
        }
        // A retrieval ran only when the question was resolved; inspect the query the pipeline received.
        if (inspectOptions && data.resolution && data.resolution.kind !== "unresolved" && data.resolution.query) {
          await inspect(id, "question", "Whole question", data.resolution.query, inspectOptions);
        }
      } catch (error) {
        const exchange = error instanceof ApiError ? error.exchange : undefined;
        if (exchange) record(exchange);
        patchRun(id, (r) => ({ ...r, pending: false, exchange, error: message(error) }));
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [inspect, patchRun, record, remember],
  );

  const value = useMemo<Store>(() => {
    const run = runs.find((r) => r.id === selected) ?? runs[runs.length - 1] ?? null;
    return {
      view,
      navigate,
      theme,
      toggleTheme,
      health,
      checkHealth,
      runs,
      run,
      selectRun: (id: string) => {
        setSelected(id);
        setHighlight([]);
      },
      busy,
      ask,
      inspect,
      sessionId,
      setSessionId,
      newSession,
      knownSessions,
      sessions,
      loadSession,
      exchanges,
      highlight,
      setHighlight,
    };
  }, [highlight,view, navigate, theme, toggleTheme, health, checkHealth, runs, selected, busy, ask, inspect, sessionId, setSessionId, newSession, knownSessions, sessions, loadSession, exchanges]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStore(): Store {
  const store = useContext(Context);
  if (!store) throw new Error("useStore outside StoreProvider");
  return store;
}
