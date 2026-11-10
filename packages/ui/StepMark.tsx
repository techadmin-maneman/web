// Where one thing of a list stands (docs/prompts/tech-redesign.md, "Visit engine"): done, a navy disc with its tick;
// under way, the brass ring; to do, the stone ring; to fix, the error's ring. The words beside it say which, so the mark
// itself is not read out.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "./Icon.tsx";
import styles from "./step-mark.module.css";

export type MarkState = "done" | "now" | "todo" | "fix";

export function StepMark({ state }: { readonly state: MarkState }) {
  return (
    <span className={styles[state]} aria-hidden="true">
      {state === "done" && <Icon d={ICONS.tick} size="xs" weight="heavy" />}
    </span>
  );
}
