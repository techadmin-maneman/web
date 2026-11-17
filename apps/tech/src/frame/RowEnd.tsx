// A one-line row's end, as the prototype's Account list draws it on Me: what the row holds, 14 px in the soft ink, then
// the chevron that says it opens.

import type { ReactNode } from "react";
import styles from "./row-end.module.css";
import { Chevron } from "./Chevron.tsx";

export function RowEnd({ value }: { readonly value: ReactNode }) {
  return (
    <span className={styles.end}>
      {value !== null && <span className={styles.value}>{value}</span>}
      <Chevron />
    </span>
  );
}
