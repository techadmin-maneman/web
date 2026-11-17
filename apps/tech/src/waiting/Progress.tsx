// The Waiting screen's progress bar. It moves on the photographs the API has confirmed,
// never on what is only held on the phone, and its width is set through the
// CSSOM so no component writes an inline style. The prototype draws it bare: a
// screen reader is told how many of the set have gone, which the eye reads off it.

import { useEffect, useRef } from "react";
import { queue as copy } from "../content.ts";
import styles from "./waiting.module.css";

export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = total === 0 ? 0 : Math.round((Math.min(done, total) / total) * 100);
    bar.current?.style.setProperty("--at", `${String(at)}%`);
  }, [done, total]);

  return (
    <div
      className={styles.bar}
      data-bar
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(done, total)}
      aria-valuetext={copy.sentOf(Math.min(done, total), total)}
    >
      <div className={styles.barDone} ref={bar} />
    </div>
  );
}
