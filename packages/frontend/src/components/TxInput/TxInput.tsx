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
  { id: '56', label: 'BNB Smart Chain' },
  { id: '43114', label: 'Avalanche C-Chain' },
  { id: '324', label: 'zkSync Era' },
  { id: '81457', label: 'Blast' },
  { id: '534352', label: 'Scroll' },
  { id: '250', label: 'Fantom' },
  { id: '100', label: 'Gnosis' },
  { id: '80094', label: 'Berachain' },
  { id: '42220', label: 'Celo' },
  { id: 'solana-mainnet', label: 'Solana' },
  { id: 'solana-devnet', label: 'Solana Devnet' },
];

export function TxInput() {
  const { dispatch } = useAnalysis();
  const [txHash, setTxHash] = useState('');
  const [networkId, setNetworkId] = useState('1');
  const closeStreamRef = useRef<(() => void) | null>(null);
  const autoSubmittedRef = useRef(false);

  // Clean up any open SSE connection when unmounting
  useEffect(() => () => { closeStreamRef.current?.(); }, []);

  // Read URL params from hash (e.g. #/?txHash=0x...&networkId=1) and auto-submit
  useEffect(() => {
    if (autoSubmittedRef.current) return;

    const hash = window.location.hash;
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) return;

    const params = new URLSearchParams(hash.slice(qIndex));
    const paramTxHash = params.get('txHash');
    const paramNetworkId = params.get('networkId');

    if (paramTxHash && paramNetworkId) {
      autoSubmittedRef.current = true;
      setTxHash(paramTxHash);
      setNetworkId(paramNetworkId);
      // Auto-submit after state is set
      setTimeout(() => {
        submitTransaction(paramTxHash, paramNetworkId);
      }, 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isSolana = networkId.startsWith('solana-');

  function submitTransaction(hash: string, network: string) {
    const isSol = network.startsWith('solana-');
    const isValidHash = isSol
      ? /^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(hash)
      : /^0x[0-9a-fA-F]{64}$/.test(hash);

    if (!isValidHash) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: isSol
          ? 'Invalid Solana transaction signature (base58).'
          : 'Invalid transaction hash. Must be 0x + 64 hex characters.',
      });
      return;
    }

    closeStreamRef.current?.();
    dispatch({ type: 'FETCH_START' });

    closeStreamRef.current = streamDebugTransaction({ txHash: hash, networkId: network }, (event) => {
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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submitTransaction(txHash, networkId);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.row}>
        <input
          className={styles.hashInput}
          type="text"
          placeholder={isSolana ? 'Transaction signature (base58...)' : 'Transaction hash (0x...)'}
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
