import { useReducer, useMemo, useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AppContext, appReducer, initialState } from "./store";
import type { HistoryEntry } from "./store";

const HISTORY_KEY = "ton-debug-agent-history";

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const ctx = useMemo(() => ({ state, dispatch }), [state]);

  // Load history from localStorage on mount
  useEffect(() => {
    dispatch({ type: "LOAD_HISTORY", entries: loadHistory() });
  }, []);

  // Save history to localStorage on change
  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  }, [state.history]);

  return (
    <AppContext.Provider value={ctx}>
      <RouterProvider router={router} />
    </AppContext.Provider>
  );
}
