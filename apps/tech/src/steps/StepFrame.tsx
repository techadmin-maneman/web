// The frame every in-job step shares (board B): the title and how far through
// the six it is at the top, the step's own body, and one primary action at the
// bottom, in the same place on every screen.

import type { ReactNode } from "react";
import { Icon } from "../components/Icon.tsx";
import { steps as copy } from "../content.ts";
import { BACK } from "../icons.ts";
import styles from "./steps.module.css";

export function StepFrame({
  title,
  at,
  of,
  action,
  ready,
  unfinished,
  onBack,
  onAction,
  children,
}: {
  readonly title: string;
  readonly at: number;
  readonly of: number;
  readonly action: string;
  /** False keeps the action in place and dims it, as the board draws an unfinished list. */
  readonly ready: boolean;
  /** What the dimmed action says instead, when the board gives it words of its own. */
  readonly unfinished?: string;
  readonly onBack: () => void;
  readonly onAction: () => void;
  readonly children: ReactNode;
}) {
  return (
    <main className={styles.screen}>
      <header className={styles.head}>
        <button className={styles.back} type="button" aria-label={copy.back} onClick={onBack}>
          <Icon d={BACK} size={24} />
        </button>
        <span className={styles.title}>{title}</span>
        <span className={styles.progress}>{copy.of(at, of)}</span>
      </header>

      <div className={styles.body}>{children}</div>

      <div className={styles.foot}>
        <button className={styles.action} type="button" disabled={!ready} onClick={onAction}>
          {ready ? action : (unfinished ?? action)}
        </button>
      </div>
    </main>
  );
}
