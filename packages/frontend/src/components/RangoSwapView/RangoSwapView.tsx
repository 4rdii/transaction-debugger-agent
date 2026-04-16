import { useState, type FormEvent } from 'react';
import type { RangoSwapOverview } from '@debugger/shared';
import { resolveRangoSwap } from '../../api/client.js';
import styles from './RangoSwapView.module.css';

interface Props {
  onAnalyze: (txHash: string, networkId: string) => void;
}

export function RangoSwapView({ onAnalyze }: Props) {
  const [swapId, setSwapId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<RangoSwapOverview | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmed = swapId.trim();
    // Basic UUID validation
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      setError('Invalid swap ID. Must be a UUID (e.g. 96e171d5-a823-405e-87c7-16e4fa77ddd9).');
      return;
    }

    setLoading(true);
    setError(null);
    setOverview(null);

    try {
      const res = await resolveRangoSwap(trimmed);
      setOverview(res.overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve swap');
    } finally {
      setLoading(false);
    }
  }

  function shortenHash(hash: string): string {
    if (hash.length <= 16) return hash;
    return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
  }

  function statusClass(status: string): string {
    if (status === 'success') return styles.statusSuccess;
    if (status === 'failed') return styles.statusFailed;
    return styles.statusRunning;
  }

  return (
    <div className={styles.container}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.row}>
          <input
            className={styles.swapIdInput}
            type="text"
            placeholder="Rango swap ID (UUID)"
            value={swapId}
            onChange={e => setSwapId(e.target.value.trim())}
            spellCheck={false}
          />
          <button className={styles.submitBtn} type="submit" disabled={loading}>
            {loading ? 'Resolving...' : 'Resolve'}
          </button>
        </div>
      </form>

      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          Fetching swap details from Rango Explorer...
        </div>
      )}

      {error && <div className={styles.error}><strong>Error:</strong> {error}</div>}

      {overview && (
        <div className={styles.overview}>
          <div className={styles.overviewHeader}>
            <span className={styles.overviewTitle}>Swap Overview</span>
            <span className={`${styles.statusBadge} ${statusClass(overview.status)}`}>
              {overview.status}
            </span>
          </div>

          {/* Token flow summary */}
          <div className={styles.tokenFlow}>
            <span className={styles.tokenAmount}>
              {Number(overview.fromToken.amount).toFixed(4)}
            </span>{' '}
            <span className={styles.tokenSymbol}>{overview.fromToken.symbol}</span>{' '}
            <span className={styles.chainLabel}>({overview.fromToken.chain})</span>
            <span className={styles.arrow}>&rarr;</span>
            <span className={styles.tokenAmount}>
              {Number(overview.toToken.amount).toFixed(4)}
            </span>{' '}
            <span className={styles.tokenSymbol}>{overview.toToken.symbol}</span>{' '}
            <span className={styles.chainLabel}>({overview.toToken.chain})</span>
          </div>

          {/* Steps */}
          {overview.steps.length > 0 && (
            <>
              <div className={styles.stepsTitle}>
                Steps ({overview.steps.length})
              </div>
              <div className={styles.stepList}>
                {overview.steps.map((step) => (
                  <div key={step.stepIndex} className={styles.step}>
                    <span className={styles.stepIndex}>#{step.stepIndex + 1}</span>
                    <span className={styles.stepSwapper}>{step.swapper.title}</span>
                    <span className={styles.stepType}>{step.swapper.type}</span>
                    <span className={styles.stepTokens}>
                      {step.from.symbol} ({step.from.chainDisplayName}) &rarr;{' '}
                      {step.to.symbol} ({step.to.chainDisplayName})
                    </span>
                    <span className={`${styles.statusBadge} ${statusClass(step.status)}`}>
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Transactions */}
          {overview.transactions.length > 0 && (
            <>
              <div className={styles.stepsTitle}>
                Transactions ({overview.transactions.length})
              </div>
              <div className={styles.txList}>
                {overview.transactions.map((tx, i) => (
                  <div key={i} className={styles.txRow}>
                    <span className={styles.txHash}>{shortenHash(tx.txHash)}</span>
                    <span className={styles.txChain}>{tx.chainDisplayName}</span>
                    <div className={styles.txLinks}>
                      {tx.explorerUrl && (
                        <a
                          className={styles.explorerLink}
                          href={tx.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Explorer
                        </a>
                      )}
                      {tx.analyzable ? (
                        <button
                          className={styles.analyzeBtn}
                          onClick={() => onAnalyze(tx.txHash, tx.networkId!)}
                        >
                          Analyze
                        </button>
                      ) : (
                        <span className={styles.unsupported}>Chain not supported</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
