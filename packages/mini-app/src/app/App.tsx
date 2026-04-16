import { useReducer, useMemo, useEffect, useState } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AppContext, appReducer, initialState } from "./store";
import { checkAuth } from "./api";
import type { TelegramUser } from "./api";
import type { HistoryEntry } from "./store";
import { OnboardingScreen } from "./screens/OnboardingScreen";

// History is stored per-Telegram-user. A single shared key would leak one
// user's analysis history to any other user who opens the Mini App on the
// same device/browser (which happens often in Telegram's in-app browser).
const HISTORY_KEY_PREFIX = "explorai-history:";
const LEGACY_HISTORY_KEY = "explorai-history";

function historyKey(userId: number | string): string {
  return `${HISTORY_KEY_PREFIX}${userId}`;
}

function loadHistory(userId: number | string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey(userId));
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Migrate the old global key (pre-fix) into the current user's namespaced key
 * IF the user has no history of their own yet. This prevents a user from
 * losing their own history on first upgrade, but avoids seeding a brand-new
 * user with a stranger's history on a shared device.
 *
 * The old key is deleted regardless so it stops being a cross-user pool.
 */
function migrateLegacyHistory(userId: number | string): void {
  try {
    const legacy = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (!legacy) return;
    const existing = localStorage.getItem(historyKey(userId));
    if (!existing) {
      localStorage.setItem(historyKey(userId), legacy);
    }
    localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    // localStorage unavailable — nothing to migrate or clean up
  }
}

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const ctx = useMemo(() => ({ state, dispatch }), [state]);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<TelegramUser | null>(null);

  // Check Telegram auth on mount; once we know who's logged in, load that
  // user's history (not whatever happens to sit in the global key).
  useEffect(() => {
    checkAuth().then(({ ok, user: u }) => {
      if (ok && u) {
        setUser(u);
        migrateLegacyHistory(u.id);
        dispatch({ type: "LOAD_HISTORY", entries: loadHistory(u.id) });
      }
      setAuthChecked(true);
    });
  }, []);

  // Save history to localStorage under the current user's key on change.
  // Skip while unauthenticated — we must never write to the legacy global key.
  useEffect(() => {
    if (!user) return;
    try {
      localStorage.setItem(historyKey(user.id), JSON.stringify(state.history));
    } catch {
      // quota or disabled storage — silently drop
    }
  }, [state.history, user]);

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
