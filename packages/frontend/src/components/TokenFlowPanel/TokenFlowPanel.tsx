import type { TokenFlow } from '@debugger/shared';
import styles from './TokenFlowPanel.module.css';

interface TokenFlowPanelProps {
  flows: TokenFlow[];
}

function shortAddr(addr: string): string {
  if (addr === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') return 'ETH';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const FLOW_TYPE_COLOR: Record<string, string> = {
  Transfer: '#58a6ff',
  Mint: '#3fb950',
  Burn: '#f85149',
  NativeTransfer: '#d2a8ff',
};

export function TokenFlowPanel({ flows }: TokenFlowPanelProps) {
  if (flows.length === 0) {
    return (
      <div className={styles.panel}>
        <h3 className={styles.title}>Token Flows</h3>
        <p className={styles.empty}>No token transfers detected.</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>Token Flows ({flows.length})</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Token</th>
              <th>From</th>
              <th>To</th>
              <th>Amount</th>
              <th>USD</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((flow, i) => (
              <tr key={i}>
                <td>
                  <span
                    className={styles.badge}
                    style={{ color: FLOW_TYPE_COLOR[flow.type] ?? '#8b949e' }}
                  >
                    {flow.type}
                  </span>
                </td>
                <td>
                  <span className={styles.token}>{flow.tokenSymbol}</span>
                  <span className={styles.tokenName}>{flow.tokenName}</span>
                </td>
                <td className={styles.addr} title={flow.from}>{shortAddr(flow.from)}</td>
                <td className={styles.addr} title={flow.to}>{shortAddr(flow.to)}</td>
                <td className={styles.amount}>{flow.formattedAmount}</td>
                <td className={styles.usd}>
                  {flow.dollarValue ? `$${parseFloat(flow.dollarValue).toLocaleString()}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
