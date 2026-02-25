import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useAnalysis } from '../../store/analysis.store.js';
import { streamDebugTransaction } from '../../api/client.js';
import styles from './TxInput.module.css';

const NETWORKS = [
  { id: '1', label: 'Ethereum Mainnet' },
  { id: '137', label: 'Polygon' },
  { id: '42161', label: 'Arbitrum One' },
  { id: '10', label: 'Optimism' },
  { id: '8453', label: 'Base' },
  { id: '59144', label: 'Linea' },
  { id: '80094', label: 'Berachain' },
];

export function TxInput() {
  const { dispatch } = useAnalysis();
  const [txHash, setTxHash] = useState('');
  const [networkId, setNetworkId] = useState('1');
  const closeStreamRef = useRef<(() => void) | null>(null);

  // Clean up any open SSE connection when unmounting
  useEffect(() => () => { closeStreamRef.current?.(); }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!txHash.match(/^0x[0-9a-fA-F]{64}$/)) {
      dispatch({ type: 'FETCH_ERROR', payload: 'Invalid transaction hash. Must be 0x + 64 hex characters.' });
      return;
    }

    // Close any previous stream
    closeStreamRef.current?.();

    dispatch({ type: 'FETCH_START' });

    closeStreamRef.current = streamDebugTransaction({ txHash, networkId }, (event) => {
      if (event.type === 'step') {
        dispatch({ type: 'PROGRESS_ADD', payload: { type: 'step', message: event.message } });
      } else if (event.type === 'tool_call') {
        dispatch({
          type: 'PROGRESS_ADD',
          payload: { type: 'tool_call', turn: event.turn, message: event.toolNames.join(', ') },
        });
      } else if (event.type === 'tool_result') {
        dispatch({
          type: 'PROGRESS_ADD',
          payload: { type: 'tool_result', turn: event.turn, toolName: event.toolName, message: event.summary },
        });
      } else if (event.type === 'complete') {
        dispatch({ type: 'FETCH_SUCCESS', payload: event.result });
        closeStreamRef.current = null;
      } else if (event.type === 'error') {
        dispatch({ type: 'FETCH_ERROR', payload: event.message });
        closeStreamRef.current = null;
      }
    });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.row}>
        <input
          className={styles.hashInput}
          type="text"
          placeholder="Transaction hash (0x...)"
          value={txHash}
          onChange={e => setTxHash(e.target.value.trim())}
          spellCheck={false}
        />
        <select
          className={styles.networkSelect}
          value={networkId}
          onChange={e => setNetworkId(e.target.value)}
        >
          {NETWORKS.map(n => (
            <option key={n.id} value={n.id}>{n.label}</option>
          ))}
        </select>
        <button className={styles.submitBtn} type="submit">
          Analyze
        </button>
      </div>
    </form>
  );
}
