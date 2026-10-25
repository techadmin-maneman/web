// The frame every in-job step shares (board B): the title and how far through
// its own work it is at the top, the step's own body, and one primary action at
// the bottom, in the same place on every screen.
//
// A step slides in on the house curve, 300 ms, as the board's motion note asks
// — except the capture screen, since nothing moves while the camera is
// capturing. A tap that lands while a step is still arriving was aimed at the
// screen before it, so the action takes none until the slide is done.

import { IconButton } from "@maneman/ui/IconButton";
import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { placeOf } from "../lib/progress.ts";
import { routeOf, usePath } from "../route.ts";
import { keptJob } from "../store/jobs.ts";
import { steps as copy, today } from "../content.ts";
import { Offline } from "../components/Banners.tsx";
import { useSession } from "../session.ts";
import { useScreen } from "../lib/useScreen.ts";
import frame from "../components/frame.module.css";
import { classes } from "@maneman/ui/classes";
import shared from "./steps.module.css";
import styles from "./step-frame.module.css";

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

/**
 * The job's steps as segments, the ones done and this one lit: how far through the whole job the technician is. Read
 * from the step's address and the card the phone keeps, so no step needs to say where it is.
 */
function Rail() {
  const route = routeOf(usePath());
  const id = route.page === "step" ? route.id : "";
  const readKept = useCallback(() => keptJob(id).catch(() => null), [id]);
  const job = valueOr(useAsync(readKept)[0], null);
  if (route.page !== "step" || job === null) return null;
  const { at, of } = placeOf(job, route.step);
  if (at === 0) return null;
  return (
    <div className={styles.rail} role="img" aria-label={copy.place(at, of)}>
      {Array.from({ length: of }, (_, index) => (
        <span key={index} className={index < at ? styles.railDone : styles.railTodo} />
      ))}
    </div>
  );
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
  const { offline } = useSession();

  return (
    <main className={still ? frame.screen : shared.sliding}>
      {offline && <Offline body={today.offline.step} />}
      <header className={classes(frame.head, styles.head)}>
        <IconButton
          className={shared.back}
          d={ICONS.back}
          size="lg"
          weight="heavy"
          label={copy.back}
          onClick={onBack}
        />
        <h1 className={shared.title} ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {at !== undefined && of !== undefined && (
          <span className={styles.progress} role="status">
            {copy.of(at, of)}
          </span>
        )}
      </header>
      <Rail />

      <div className={styles.body}>
        {notice !== undefined && notice !== null && (
          <p className={styles.notice} role="alert">
            {notice}
          </p>
        )}
        {children}
      </div>

      <div className={frame.foot}>
        {foot ?? (
          <Button
            variant="gold"
            size="action"
            className={frame.action}
            disabled={!ready}
            settling={!settled}
            onClick={onAction}
          >
            {ready ? action : (unfinished ?? action)}
          </Button>
        )}
      </div>
    </main>
  );
}
