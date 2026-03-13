import { useReducer, useMemo, useEffect, useState } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AppContext, appReducer, initialState } from "./store";
import { checkAuth } from "./api";
import type { TelegramUser } from "./api";
import type { HistoryEntry } from "./store";
import { OnboardingScreen } from "./screens/OnboardingScreen";

const HISTORY_KEY = "explorai-history";

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
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<TelegramUser | null>(null);

  // Check Telegram auth on mount
  useEffect(() => {
    checkAuth().then(({ ok, user: u }) => {
      if (ok && u) setUser(u);
      setAuthChecked(true);
    });
  }, []);

  // Load history from localStorage on mount
  useEffect(() => {
    dispatch({ type: "LOAD_HISTORY", entries: loadHistory() });
  }, []);

  // Save history to localStorage on change
  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  }, [state.history]);

  // Show nothing while checking auth
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0F1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#0098EA] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Show onboarding if not authenticated via Telegram
  if (!user) {
    return <OnboardingScreen />;
  }

  return (
    <AppContext.Provider value={ctx}>
      <RouterProvider router={router} />
    </AppContext.Provider>
  );
}
