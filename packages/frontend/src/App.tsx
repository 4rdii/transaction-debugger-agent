import { useMemo, useState, useCallback, useEffect } from 'react';
import { AnalysisContext, useAnalysisReducer } from './store/analysis.store.js';
import { TxInput } from './components/TxInput/TxInput.js';
import { AnalysisView } from './components/AnalysisView/AnalysisView.js';
import { ProgressLog } from './components/ProgressLog/ProgressLog.js';
import { RangoSwapView } from './components/RangoSwapView/RangoSwapView.js';
import styles from './App.module.css';

type Page = 'debug' | 'rango';

export function App() {
  const [state, dispatch] = useAnalysisReducer();
  const contextValue = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  const [page, setPage] = useState<Page>(() => {
    return window.location.hash === '#/rango' ? 'rango' : 'debug';
  });

  // Sync hash with page state
  useEffect(() => {
    function onHashChange() {
      setPage(window.location.hash === '#/rango' ? 'rango' : 'debug');
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function navigate(p: Page) {
    window.location.hash = p === 'rango' ? '#/rango' : '#/';
    setPage(p);
  }

  // When user clicks "Analyze" on a Rango tx, switch to debug page with params
  const handleRangoAnalyze = useCallback((txHash: string, networkId: string) => {
    const params = new URLSearchParams({ txHash, networkId });
    window.location.hash = `#/?${params.toString()}`;
    setPage('debug');
  }, []);

  return (
    <AnalysisContext.Provider value={contextValue}>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}>&#x2B21;</span>
            <span className={styles.logoText}>Explorai</span>
          </div>
          <nav className={styles.nav}>
            <button
              className={`${styles.navBtn} ${page === 'debug' ? styles.navActive : ''}`}
              onClick={() => navigate('debug')}
            >
              Debug Transaction
            </button>
            <button
              className={`${styles.navBtn} ${page === 'rango' ? styles.navActive : ''}`}
              onClick={() => navigate('rango')}
            >
              Rango Swap
            </button>
          </nav>
          <p className={styles.tagline}>
            Paste any EVM or Solana transaction hash, or resolve a Rango swap ID.
          </p>
        </header>

        <main className={styles.main}>
          {page === 'debug' && (
            <>
              <div className={styles.inputSection}>
                <TxInput />
              </div>

              {state.loading && (
                <ProgressLog entries={state.progressLog} />
              )}

              {state.error && !state.loading && (
                <div className={styles.error}>
                  <strong>Error:</strong> {state.error}
                </div>
              )}

              {state.result && !state.loading && (
                <AnalysisView result={state.result} />
              )}
            </>
          )}

          {page === 'rango' && (
            <RangoSwapView onAnalyze={handleRangoAnalyze} />
          )}
        </main>
      </div>
    </AnalysisContext.Provider>
  );
}
