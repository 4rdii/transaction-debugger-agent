import type { AnalysisResult } from '@debugger/shared';
import { CallTree } from '../CallTree/CallTree.js';
import { TokenFlowPanel } from '../TokenFlowPanel/TokenFlowPanel.js';
import { QAChat } from '../QAChat/QAChat.js';
import styles from './AnalysisView.module.css';

interface AnalysisViewProps {
  result: AnalysisResult;
}

const RISK_COLOR: Record<string, string> = {
  high: '#f85149',
  medium: '#e3b341',
  low: '#8b949e',
};

export function AnalysisView({ result }: AnalysisViewProps) {
  return (
    <div className={styles.view}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.statusRow}>
          <span className={result.success ? styles.successBadge : styles.failBadge}>
            {result.success ? '✓ SUCCESS' : '✕ FAILED'}
          </span>
          <span className={styles.meta}>
            Block #{result.blockNumber} · {result.gasUsed.toLocaleString()} gas · Network {result.networkId}
          </span>
        </div>
        <div className={styles.hash}>{result.txHash}</div>
      </div>

      {/* LLM Explanation */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>AI Explanation</h3>
        <pre className={styles.explanation}>{result.llmExplanation}</pre>
      </section>

      {/* Detected Actions */}
      {result.semanticActions.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Detected Actions</h3>
          <div className={styles.actions}>
            {result.semanticActions.map((action, i) => (
              <div key={i} className={styles.action}>
                <span className={styles.actionType}>{action.type}</span>
                {action.protocol && <span className={styles.actionProtocol}>{action.protocol}</span>}
                <span className={styles.actionDesc}>{action.description}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Failure Reason */}
      {result.failureReason && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Failure Analysis</h3>
          <div className={styles.failureBox}>
            <div className={styles.failureReason}>Revert: {result.failureReason.reason}</div>
            <div className={styles.failureExplanation}>{result.failureReason.explanation}</div>
          </div>
        </section>
      )}

      {/* Risk Flags */}
      {result.riskFlags.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Risk Flags</h3>
          <div className={styles.risks}>
            {result.riskFlags.map((flag, i) => (
              <div key={i} className={styles.risk} style={{ borderLeftColor: RISK_COLOR[flag.level] }}>
                <span className={styles.riskLevel} style={{ color: RISK_COLOR[flag.level] }}>
                  {flag.level.toUpperCase()}
                </span>
                <span className={styles.riskType}>{flag.type}</span>
                <span className={styles.riskDesc}>{flag.description}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Token Flows */}
      <section className={styles.section}>
        <TokenFlowPanel flows={result.tokenFlows} />
      </section>

      {/* Call Tree */}
      <section className={styles.section}>
        <CallTree root={result.callTree} />
      </section>

      {/* Q&A */}
      <section className={styles.section}>
        <QAChat />
      </section>
    </div>
  );
}
