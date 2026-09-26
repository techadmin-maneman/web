// How long a queued request has left before the day it falls due, as board D2
// words its last column, and in oxblood once it has run over. Every queue reads
// its due day from the API, which counts it as the Tasks board does, so the two
// can never disagree (src/policy/tasks.ts).

import { waiting } from "../content.ts";
import { daysUntil } from "./due.ts";
import styles from "./left.module.css";

function wordsOf(days: number): string {
  if (days < 0) return waiting.over(-days);
  return days === 0 ? waiting.today : waiting.left(days);
}

export function Left({ due, now }: { due: string; now: Date }) {
  const days = daysUntil(due, now);
  return <span className={days < 0 ? styles.late : styles.left}>{wordsOf(days)}</span>;
}
