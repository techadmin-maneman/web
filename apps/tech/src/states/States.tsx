// A page's data on its way, and a page whose data did not come. The design
// draws neither for this app, so they follow the client app's shapes on ink.

import { session } from "../content.ts";
import styles from "./states.module.css";

export function Loading() {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.hidden}>{session.checking}</span>
      <div className={styles.line} />
      <div className={styles.card} />
    </div>
  );
}

export function Failed({ message, retry, onRetry }: { message: string; retry: string; onRetry: () => void }) {
  return (
    <div className={styles.failed} role="alert">
      <p className={styles.line1}>{message}</p>
      <button className={styles.retry} type="button" onClick={onRetry}>
        {retry}
      </button>
    </div>
  );
}
