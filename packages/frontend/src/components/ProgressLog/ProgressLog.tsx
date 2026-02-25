import { useEffect, useRef } from 'react';
import type { ProgressEntry } from '../../store/analysis.store.js';
import styles from './ProgressLog.module.css';

interface Props {
  entries: ProgressEntry[];
}

const TOOL_ICONS: Record<string, string> = {
  get_call_tree:             '🌲',
  extract_token_flows:       '💸',
  detect_semantic_actions:   '🔍',
  analyze_failure:           '💥',
  detect_risks:              '⚠️',
  get_call_subtree:          '🔎',
  get_contract_abi:          '📄',
  get_revert_source_location:'📝',
  cast_call:                 '📡',
  cast_run:                  '🔄',
  simulate_with_fix:         '🔧',
};

function toolIcon(name?: string) {
  return name ? (TOOL_ICONS[name] ?? '🛠') : '🛠';
}

export function ProgressLog({ entries }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.spinner} />
        <span>Analyzing…</span>
      </div>
      <div className={styles.log}>
        {entries.map((entry, i) => {
          if (entry.type === 'step') {
            return (
              <div key={i} className={styles.step}>
                <span className={styles.dot}>›</span>
                <span>{entry.message}</span>
              </div>
            );
          }
          if (entry.type === 'tool_call') {
            const names = entry.message.split(', ');
            return (
              <div key={i} className={styles.toolCall}>
                <span className={styles.turnLabel}>Turn {entry.turn}</span>
                {names.map(n => (
                  <span key={n} className={styles.toolBadge}>
                    {toolIcon(n)} {n}
                  </span>
                ))}
              </div>
            );
          }
          if (entry.type === 'tool_result') {
            return (
              <div key={i} className={styles.toolResult}>
                <span className={styles.checkmark}>✓</span>
                <span className={styles.resultText}>{entry.message}</span>
              </div>
            );
          }
          return null;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
