// The frame every in-job step shares (board B): the title and how far through
// its own work it is at the top, the step's own body, and one primary action at
// the bottom, in the same place on every screen.
//
// A step slides in on the house curve, 300 ms, as the board's motion note asks
// — except the capture screen, since nothing moves while the camera is
// capturing. A tap that lands while a step is still arriving was aimed at the
// screen before it, so the action takes none until the slide is done.

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon.tsx";
import { steps as copy } from "../content.ts";
import { BACK } from "../icons.ts";
import { useScreen } from "../lib/useScreen.ts";
import styles from "./steps.module.css";

/** The slide's 300 ms and a little: a second tap of a gloved double tap lands inside it. */
const SETTLE_MS = 350;

/**
 * Whether the screen has finished arriving. Until it has, its action is marked
 * unavailable to assistive technology and ignores a tap, without being drawn
 * dim: a tap meant for the screen before must not finish this one.
 */
export function useSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(true);
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return settled;
}

export function StepFrame({
  title,
  at,
  of,
  action,
  ready,
  unfinished,
  notice,
  still = false,
  foot,
  onBack,
  onAction,
  children,
}: {
  readonly title: string;
  /** How far through this screen's own work it is — angles taken, items ticked — or nothing. */
  readonly at?: number;
  readonly of?: number;
  readonly action: string;
  /** False keeps the action in place and dims it, as the board draws an unfinished list. */
  readonly ready: boolean;
  /** What the dimmed action says instead, when the board gives it words of its own. */
  readonly unfinished?: string;
  /** A line above the step's body: the API refused what this step sent, and it is being put right. */
  readonly notice?: string | null;
  /** True for the capture screen, which does not slide. */
  readonly still?: boolean;
  /** A foot of the screen's own in place of the one action: the capture screen's Retake and Capture. */
  readonly foot?: ReactNode;
  readonly onBack: () => void;
  readonly onAction: () => void;
  readonly children: ReactNode;
}) {
  const heading = useScreen(title);
  const settled = useSettled();

  return (
    <main className={still ? styles.screen : styles.sliding}>
      <header className={styles.head}>
        <button className={styles.back} type="button" aria-label={copy.back} onClick={onBack}>
          <Icon d={BACK} size={24} />
        </button>
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {at !== undefined && of !== undefined && (
          <span className={styles.progress} role="status">
            {copy.of(at, of)}
          </span>
        )}
      </header>

      <div className={styles.body}>
        {notice !== undefined && notice !== null && (
          <p className={styles.notice} role="alert">
            {notice}
          </p>
        )}
        {children}
      </div>

      <div className={styles.foot}>
        {foot ?? (
          <button
            className={styles.action}
            type="button"
            disabled={!ready}
            aria-disabled={!settled}
            onClick={() => {
              if (settled) onAction();
            }}
          >
            {ready ? action : (unfinished ?? action)}
          </button>
        )}
      </div>
    </main>
  );
}
