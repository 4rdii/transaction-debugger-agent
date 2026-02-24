import { useMemo } from 'react';
import { AnalysisContext, useAnalysisReducer } from './store/analysis.store.js';
import { TxInput } from './components/TxInput/TxInput.js';
import { AnalysisView } from './components/AnalysisView/AnalysisView.js';
import styles from './App.module.css';

export function App() {
  const [state, dispatch] = useAnalysisReducer();
  const contextValue = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <AnalysisContext.Provider value={contextValue}>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}>⬡</span>
            <span className={styles.logoText}>AI Tx Debugger</span>
          </div>
          <p className={styles.tagline}>
            Paste any EVM transaction hash to get an AI-powered explanation of what happened.
          </p>
        </header>

        <main className={styles.main}>
          <div className={styles.inputSection}>
            <TxInput />
          </div>

          {state.loading && (
            <div className={styles.loading}>
              <div className={styles.spinner} />
              <span>Fetching trace, simulating, and reasoning...</span>
            </div>
          )}

          {state.error && !state.loading && (
            <div className={styles.error}>
              <strong>Error:</strong> {state.error}
            </div>
          )}

          {state.result && !state.loading && (
            <AnalysisView result={state.result} />
          )}
        </main>
      </div>
    </AnalysisContext.Provider>
  );
}
