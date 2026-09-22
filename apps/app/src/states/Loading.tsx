// Board B3's loading state: the shape of a label and a card while a page's data comes.

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
