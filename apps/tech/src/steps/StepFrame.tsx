// A step of the visit in the new look (docs/prompts/tech-redesign.md, "Visit engine"; docs/decisions/0245-the-steps.md):
// the step's name with the client and the visit beneath, the visit's steps as a bar with "Step n of N" and All steps,
// the step's own body, and one action at the foot, "Next: <the step after>". What the action still waits on is said
// above it. A step the API refused says so in red.
//
// A step slides in on the house curve, 300 ms. A tap that lands while a step is still arriving was aimed at the
// screen before it, so the action takes none until the slide is done.

import { ICONS } from "@maneman/brand/icons";
import { ActionBar } from "@maneman/ui/ActionBar";
import { Button } from "@maneman/ui/Button";
import { IconButton } from "@maneman/ui/IconButton";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { StepProgress, type StepState } from "@maneman/ui/Progress";
import { Link } from "@maneman/ui/router";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Job } from "../api.ts";
import { steps as copy, visit } from "../content.ts";
import { NoSignal } from "../frame/Banners.tsx";
import { kindNameLower } from "../lib/kind.ts";
import { done } from "../lib/progress.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { routeOf, usePath } from "../route.ts";
import { useSession } from "../session.ts";
import { keptJob } from "../store/jobs.ts";
import { screensOf } from "../visit/index.ts";
import styles from "./step-frame.module.css";

/** The slide's 300 ms and a little: a second tap of a gloved double tap lands inside it. */
const SETTLE_MS = 350;

/**
 * Whether the screen has finished arriving. Until it has, its action is marked unavailable to assistive technology
 * and ignores a tap, without being drawn dim: a tap meant for the screen before must not finish this one.
 */
function useSettled(): boolean {
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

/** Where the visit stands, from the step's address and the card the phone keeps: no step needs to say where it is. */
interface Where {
  readonly job: Job;
  readonly at: number;
  readonly states: readonly StepState[];
  /** The step after this one, by its name; null on the last. */
  readonly next: string | null;
}

function useWhere(): Where | null {
  const route = routeOf(usePath());
  const id = route.page === "step" ? route.id : "";
  const readKept = useCallback(() => keptJob(id).catch(() => null), [id]);
  const job = valueOr(useAsync(readKept)[0], null);
  const { events } = useOutbox();
  if (route.page !== "step" || job === null) return null;
  const screens = screensOf(job);
  const sent = done(job, events);
  const here = screens.findIndex((screen) => screen.event === route.step);
  const states = screens.map((screen, index): StepState => {
    if (index === here) return "current";
    return sent.has(screen.event) ? "done" : "todo";
  });
  return { job, at: here + 1, states, next: screens[here + 1]?.title ?? null };
}

/** The visit's steps as a bar, with which one this is, opening the visit's plan. */
function StepBar({ where }: { where: Where }) {
  return (
    <Link className={styles.bar} to={`/jobs/${where.job.id}/plan`} aria-label={visit.allSteps}>
      <StepProgress steps={where.states} />
      <span className={styles.barLine}>
        <span>{visit.step(where.at, where.states.length)}</span>
        <span className={styles.allSteps}>
          {visit.allSteps}
          <span aria-hidden="true"> ›</span>
        </span>
      </span>
    </Link>
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
  onBack,
  onAction,
  children,
}: {
  readonly title: string;
  /** How far through this screen's own work it is: items done, tasks seen. */
  readonly at?: number;
  readonly of?: number;
  /** The action's words where they are not "Next: <the step after>": the outcome's, say. */
  readonly action?: string;
  /** False keeps the action in place and dims it, with `unfinished` above it saying what is missing. */
  readonly ready: boolean;
  readonly unfinished?: string;
  /** The API refused what this step sent, and it is being put right. */
  readonly notice?: string | null;
  readonly onBack: () => void;
  readonly onAction: () => void;
  readonly children: ReactNode;
}) {
  const heading = useScreen(title);
  const settled = useSettled();
  const { offline } = useSession();
  const where = useWhere();
  const label = action ?? (where?.next === null || where === null ? visit.close : visit.next(where.next));
  return (
    <main className={styles.screen} data-look="light">
      <header className={styles.head}>
        <IconButton className={styles.back} d={ICONS.back} size="lg" label={copy.back} onClick={onBack} />
        <div className={styles.who}>
          <h1 className={styles.title} ref={heading} tabIndex={-1}>
            {title}
          </h1>
          {where !== null && (
            <p className={styles.sub}>
              {visit.whoAndWhat(where.job.client?.name ?? kindNameLower(where.job), kindNameLower(where.job))}
            </p>
          )}
        </div>
      </header>
      {offline && <NoSignal />}
      {where !== null && <StepBar where={where} />}
      <div className={styles.body}>
        {notice !== undefined && notice !== null && (
          <ProblemCard className={styles.notice} title={visit.plan.needsFix} live>
            {notice}
          </ProblemCard>
        )}
        {at !== undefined && of !== undefined && (
          <p className={styles.count} role="status">
            {copy.of(at, of)}
          </p>
        )}
        {children}
      </div>
      <ActionBar helper={ready ? undefined : unfinished}>
        {(helperId) => (
          <Button
            variant="primary"
            size="action"
            disabled={!ready}
            settling={!settled}
            aria-describedby={helperId}
            onClick={onAction}
          >
            {label}
          </Button>
        )}
      </ActionBar>
    </main>
  );
}
