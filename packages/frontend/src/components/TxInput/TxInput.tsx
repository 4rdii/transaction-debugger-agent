import { useState, type FormEvent } from 'react';
import { useAnalysis } from '../../store/analysis.store.js';
import { debugTransaction } from '../../api/client.js';
import styles from './TxInput.module.css';

const NETWORKS = [
  { id: '1', label: 'Ethereum Mainnet' },
  { id: '137', label: 'Polygon' },
  { id: '42161', label: 'Arbitrum One' },
  { id: '10', label: 'Optimism' },
  { id: '8453', label: 'Base' },
];

export function TxInput() {
  const { dispatch } = useAnalysis();
  const [txHash, setTxHash] = useState('');
  const [networkId, setNetworkId] = useState('1');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!txHash.match(/^0x[0-9a-fA-F]{64}$/)) {
      dispatch({ type: 'FETCH_ERROR', payload: 'Invalid transaction hash. Must be 0x + 64 hex characters.' });
      return;
    }

    dispatch({ type: 'FETCH_START' });
    try {
      const res = await debugTransaction({ txHash, networkId });
      dispatch({ type: 'FETCH_SUCCESS', payload: res.result });
    } catch (err) {
      dispatch({ type: 'FETCH_ERROR', payload: err instanceof Error ? err.message : 'Unknown error' });
    }
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
