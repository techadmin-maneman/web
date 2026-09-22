// A page whose data did not come: one line and "Try again". The design draws
// this for Home only (board B3); the other pages say it more plainly.

import { errors } from "../content.ts";
import styles from "./states.module.css";

export function PageFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.pageFailed} role="alert">
      <p>{errors.load}</p>
      <button className={styles.retry} type="button" onClick={onRetry}>
        {errors.retry}
      </button>
    </div>
  );
}
