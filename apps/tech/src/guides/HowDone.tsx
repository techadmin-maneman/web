// "How this visit is done", as the prototype draws it on a later job's preview and on the job (docs/prompts/
// tech-redesign.md, "Job"): one line under the ink's heavier rule, the visit's steps counted at its end, opening the
// guide to that kind of visit.

import { Link } from "@maneman/ui/router";
import { guides as copy } from "../content.ts";
import styles from "./guides.module.css";

export function HowDone({ to, steps }: { readonly to: string; readonly steps: number }) {
  return (
    <Link className={styles.howDone} to={to}>
      <span className={styles.howDoneTitle}>{copy.howDone}</span>
      <span className={styles.howDoneCount}>{copy.steps(steps)}</span>
    </Link>
  );
}
