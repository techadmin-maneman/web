// Where one thing of a list stands (docs/prompts/tech-redesign.md, "Visit engine"): done, a navy disc with its tick;
// under way, the brass ring round its dot; to do, the stone ring, or a quieter one round its number where the list
// counts its steps; to fix, the error's ring. The words beside it say which, so the mark itself is not read out.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "./Icon.tsx";
import styles from "./step-mark.module.css";

export type MarkState = "done" | "now" | "todo" | "fix";

export function StepMark({ state, n }: { readonly state: MarkState; readonly n?: number }) {
  const numbered = state === "todo" && n !== undefined;
  return (
    <span className={numbered ? styles.numbered : styles[state]} aria-hidden="true">
      {state === "done" && <Icon d={ICONS.tick} size="xs" weight="heavy" />}
      {state === "now" && <span className={styles.dot} />}
      {numbered && String(n)}
    </span>
  );
}
