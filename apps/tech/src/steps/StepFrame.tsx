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
import { Safety } from "../frame/Safety.tsx";
import { kindNameLower } from "../lib/kind.ts";
import { done, sentBackFor } from "../lib/progress.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { routeOf, usePath } from "../route.ts";
import { useSession } from "../session.ts";
import { keptJob } from "../store/jobs.ts";
import { screensOf } from "../visit/index.ts";
import styles from "./step-frame.module.css";
import { theirs } from "../lang/index.ts";

/** The slide's 300 ms and a little: a second tap of a gloved double tap lands inside it. */
const SETTLE_MS = 350;

const ARRIVING = Symbol("arriving");

/**
 * Whether the screen, or the page of it now showing, has finished arriving. Until it has, its action is marked
 * unavailable to assistive technology and ignores a tap, without being drawn dim: a tap meant for the page before must
 * not finish this one.
 */
function useSettled(page: unknown): boolean {
  const [settledOn, setSettledOn] = useState<unknown>(ARRIVING);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettledOn(page);
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [page]);
  return Object.is(settledOn, page);
}

/** Where the visit stands, from the step's address and the card the phone keeps: no step needs to say where it is. */
interface Where {
  readonly job: Job;
  readonly at: number;
  readonly states: readonly StepState[];
  /** The step the visit goes to after this one, by its name: the first after it not yet sent; null where none is. */
  readonly next: string | null;
  /** Why ops sent this step back, while the phone has not sent it again; null for a step not sent back. */
  readonly sentBack: string | null;
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
  // A step the card's visit has no screen for, as a card kept from before the visit's type changed: no bar to draw.
  if (here < 0) return null;
  const states = screens.map((screen, index): StepState => {
    if (index === here) return "current";
    return sent.has(screen.event) ? "done" : "todo";
  });
  const next = screens.slice(here + 1).find((screen) => screen.event !== route.step && !sent.has(screen.event));
  return { job, at: here + 1, states, next: next?.title ?? null, sentBack: sentBackFor(job, events, route.step) };
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

/** "Next: <the step it goes to>", "Close visit" where none is left, or plain Next where the visit's place is not known. */
function labelOf(where: Where | null): string {
  if (where === null) return copy.next;
  if (where.next !== null) return visit.next(where.next);
  // A step ops sent back sends itself; the visit's close is behind it.
  return where.sentBack === null ? visit.close : visit.sendFix;
}

/** What ops said when they sent the step back, their words as they wrote them. */
const sentBackLine = (reason: string | null): string | null =>
  reason === null ? null : visit.sentBack(theirs(reason));

export function StepFrame({
  title,
  at,
  of,
  page,
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
  /** Which page of the step is showing, where it has several: the action waits for each to arrive. */
  readonly page?: number | string;
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
  const settled = useSettled(page);
  const { offline } = useSession();
  const where = useWhere();
  const label = action ?? labelOf(where);
  // A refusal says what to put right; failing one, what ops said when they sent the step back.
  const said = notice ?? sentBackLine(where?.sentBack ?? null);
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
        {where !== null && <Safety jobId={where.job.id} className={styles.safety} />}
      </header>
      {offline && <NoSignal />}
      {where !== null && <StepBar where={where} />}
      <div className={styles.body}>
        {said !== null && (
          <ProblemCard className={styles.notice} title={visit.plan.needsFix} live>
            {said}
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
