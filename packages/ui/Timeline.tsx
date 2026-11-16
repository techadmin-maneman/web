// A log down the page, oldest first: each line when it was, who, and what, on a thread of dots (design/client-redesign,
// an issue's log and every hair system worn). A dot is ringed for the client's own line, filled in navy for ours, in
// green for the line that ended it, and dashed in brass for what is still waited on.
//
//   <Timeline items={[{ key: "1", when: "14 Nov, 3:42 pm", who: "You", text: "The front lifts." }]} />

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./timeline.module.css";

export type TimelineTone = "theirs" | "ours" | "done" | "waiting";

export interface TimelineItem {
  readonly key: string;
  readonly when?: ReactNode;
  readonly who: ReactNode;
  readonly text?: ReactNode;
  readonly tone?: TimelineTone;
}

const TONE: Readonly<Record<TimelineTone, string | undefined>> = {
  theirs: undefined,
  ours: styles.ours,
  done: styles.done,
  waiting: styles.waiting,
};

export function Timeline({
  items,
  className,
}: {
  readonly items: readonly TimelineItem[];
  readonly className?: string;
}) {
  return (
    <ol className={classes(styles.timeline, className)}>
      {items.map((item) => (
        <li key={item.key} className={classes(styles.item, TONE[item.tone ?? "theirs"])}>
          {item.when !== undefined && <span className={styles.when}>{item.when}</span>}
          <span className={styles.who}>{item.who}</span>
          {item.text !== undefined && <span className={styles.text}>{item.text}</span>}
        </li>
      ))}
    </ol>
  );
}
