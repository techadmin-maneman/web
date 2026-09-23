// What a panel shows while its data comes, and when it does not. The ops
// boards draw neither, so these follow the client app's (board B3): the shape
// of a label and a card, then one line and a way to try again.

import { states } from "../content.ts";
import styles from "./states.module.css";

export function Loading() {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.hidden}>{states.loading}</span>
      <div className={styles.line} />
      <div className={styles.card} />
    </div>
  );
}

export function PanelFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.failed} role="alert">
      <p className={styles.message}>{states.failed}</p>
      <button className={styles.retry} type="button" onClick={onRetry}>
        {states.retry}
      </button>
    </div>
  );
}
