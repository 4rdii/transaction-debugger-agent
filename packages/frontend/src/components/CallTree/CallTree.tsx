import type { NormalizedCall } from '@debugger/shared';
import { CallNode } from './CallNode.js';
import styles from './CallTree.module.css';

interface CallTreeProps {
  root: NormalizedCall;
}

export function CallTree({ root }: CallTreeProps) {
  return (
    <div className={styles.tree}>
      <h3 className={styles.title}>Call Tree</h3>
      <CallNode call={root} />
    </div>
  );
}
