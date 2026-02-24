import { useState } from 'react';
import type { NormalizedCall } from '@debugger/shared';
import styles from './CallTree.module.css';

interface CallNodeProps {
  call: NormalizedCall;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function CallNode({ call }: CallNodeProps) {
  const [expanded, setExpanded] = useState(call.depth < 2);
  const hasChildren = call.children.length > 0;

  const statusClass = call.success ? styles.success : styles.failure;
  const callTypeColor: Record<string, string> = {
    CALL: '#58a6ff',
    DELEGATECALL: '#f78166',
    STATICCALL: '#8b949e',
    CREATE: '#3fb950',
    CREATE2: '#3fb950',
  };

  return (
    <div className={styles.node}>
      <div
        className={`${styles.nodeHeader} ${statusClass}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
      >
        <span className={styles.toggle}>
          {hasChildren ? (expanded ? '▼' : '▶') : '·'}
        </span>
        <span
          className={styles.callType}
          style={{ color: callTypeColor[call.callType] ?? '#8b949e' }}
        >
          {call.callType}
        </span>
        <span className={styles.contract}>
          {call.contractName ?? shortAddr(call.callee)}
        </span>
        {call.functionName && (
          <span className={styles.fn}>.{call.functionName.split('(')[0]}</span>
        )}
        {call.protocol && (
          <span className={styles.protocol}>[{call.protocol}]</span>
        )}
        <span className={styles.gas}>{call.gasUsed.toLocaleString()} gas</span>
        {!call.success && call.revertReason && (
          <span className={styles.revert} title={call.revertReason}>
            ✕ {call.revertReason.slice(0, 40)}{call.revertReason.length > 40 ? '…' : ''}
          </span>
        )}
      </div>

      {expanded && call.decodedInputs.length > 0 && (
        <div className={styles.params}>
          {call.decodedInputs.map((p, i) => {
            const val = typeof p.value === 'string' ? p.value : String(p.value ?? '');
            return (
              <div key={i} className={styles.param}>
                <span className={styles.paramType}>{p.type}</span>
                <span className={styles.paramName}>{p.name}</span>
                <span className={styles.paramValue}>{val.slice(0, 80)}{val.length > 80 ? '…' : ''}</span>
              </div>
            );
          })}
        </div>
      )}

      {expanded && hasChildren && (
        <div className={styles.children}>
          {call.children.map(child => (
            <CallNode key={child.id} call={child} />
          ))}
        </div>
      )}
    </div>
  );
}
