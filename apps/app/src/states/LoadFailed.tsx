// Board B3's error state: the app could not load, with a way to try again and a way to reach us.

import { states, whatsapp } from "../content.ts";
import styles from "./states.module.css";

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const copy = states.error;
  return (
    <main className={styles.failed}>
      <div role="alert">
        <h1 className={styles.title}>{copy.title}</h1>
      </div>
      <div className={styles.actions}>
        <button className={styles.retry} type="button" onClick={onRetry}>
          {copy.retry}
        </button>
        <a className={styles.message} href={`https://wa.me/${whatsapp.number}`} rel="noopener">
          {copy.message}
        </a>
      </div>
    </main>
  );
}
