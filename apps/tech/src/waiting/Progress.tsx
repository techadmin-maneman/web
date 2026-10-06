// The Waiting screen's progress bar. It moves on the photographs the API has confirmed,
// never on what is only held on the phone, and its width is set through the
// CSSOM so no component writes an inline style.

import { useEffect, useRef } from "react";
import styles from "./waiting.module.css";

export function Progress({ done, total }: { done: number; total: number }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = total === 0 ? 0 : Math.round((Math.min(done, total) / total) * 100);
    bar.current?.style.setProperty("--at", `${String(at)}%`);
  }, [done, total]);

  return (
    <div className={styles.bar} data-bar>
      <div className={styles.barDone} ref={bar} />
    </div>
  );
}
