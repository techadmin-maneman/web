// Board A2's progress bar. It moves on real frames, not on a guess, and its
// width is set through the CSSOM so no component writes an inline style.

import { useEffect, useRef } from "react";
import styles from "./waiting.module.css";

export function Progress({ done, total }: { done: number; total: number }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = total === 0 ? 0 : Math.round((Math.min(done, total) / total) * 100);
    bar.current?.style.setProperty("--at", `${String(at)}%`);
  }, [done, total]);

  return (
    <div className={styles.bar}>
      <div className={styles.barDone} ref={bar} />
    </div>
  );
}
