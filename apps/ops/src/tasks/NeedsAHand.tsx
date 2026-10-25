// Tasks' Alerts: what ops were told of in the alert space, each until somebody puts right what it was about
// (src/routes/ops/alerts.ts), a kind's together. Each says what happened, whose visit, and links to where to act; ops
// mark one done, or send again the message, lead or CRM erasure it gave up on. Each person sees their departments' kinds.

import { Disclosure } from "@maneman/ui/Disclosure";
import { TextButton } from "@maneman/ui/TextLink";
import { errorText } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState } from "react";
import { type OpenAlert } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { needsAHand as copy } from "../content.ts";
import { alertNeed, markDoneNeed, useAccess, type Access } from "../lib/access.ts";
import { PanelFailed } from "../states/States.tsx";
import shared from "./tasks.module.css";
import styles from "./needs-ahand.module.css";
import { headlineOf } from "./alert-headline.ts";
import { tasksApi } from "./tasks-api.ts";

/** The few words that name what went wrong. */
function titleOf(kind: string): string {
  const named = copy.kinds[kind];
  if (named !== undefined) return named;
  return kind.startsWith("books_") ? copy.books : copy.other;
}

type Action = "send" | "done";

interface RowProps {
  readonly alert: OpenAlert;
  readonly maySend: boolean;
  readonly mayMarkDone: boolean;
  readonly onClosed: () => void;
}

function AlertRow({ alert, maySend, mayMarkDone, onClosed }: RowProps) {
  const [busy, once] = useOneAtATime();
  const [acting, setActing] = useState<Action | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const title = titleOf(alert.kind);

  const act = (action: Action) =>
    once(async () => {
      setActing(action);
      setFailed(null);
      const answer =
        action === "send" ? await tasksApi.sendAlertAgain(alert.id) : await tasksApi.resolveAlert(alert.id);
      setActing(null);
      if (answer.ok) onClosed();
      else setFailed(answer.code);
    });

  return (
    <li className={shared.alert}>
      <div className={shared.what}>
        <span className={shared.subject}>{title}</span>
        <span className={shared.sub}>{headlineOf(alert.message)}</span>
        {alert.about !== null && <span className={shared.sub}>{alert.about}</span>}
        {headlineOf(alert.message) !== alert.message && (
          <Disclosure summary={copy.details}>
            <span className={shared.sub}>{alert.message}</span>
          </Disclosure>
        )}

        <span className={shared.acts}>
          {alert.link !== null && (
            <OpsLink className={shared.decide} to={alert.link}>
              {copy.open}
              <VisuallyHidden>{` · ${title}`}</VisuallyHidden>
            </OpsLink>
          )}
          {maySend && alert.send_again && (
            <TextButton tone="muted" compact disabled={busy} onClick={() => void act("send")}>
              {acting === "send" ? copy.sending : copy.sendAgain}
              <VisuallyHidden>{` · ${title}`}</VisuallyHidden>
            </TextButton>
          )}
          {mayMarkDone && (
            <TextButton tone="muted" compact disabled={busy} onClick={() => void act("done")}>
              {acting === "done" ? copy.closing : copy.done}
              <VisuallyHidden>{` · ${title}`}</VisuallyHidden>
            </TextButton>
          )}
        </span>
        {failed !== null && (
          <span className={shared.error} role="alert">
            {errorText(copy.errors, { code: failed })}
          </span>
        )}
      </div>
      <span className={styles.sla}>{copy.seen(alert.count, shortDate(indiaDate(alert.told_at)))}</span>
    </li>
  );
}

function AlertList({ access, onCount }: { access: Access; onCount: (count: number) => void }) {
  const [loaded, retry] = useLoad(tasksApi.alerts);
  const [closed, setClosed] = useState<readonly string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const open = loaded.state === "loaded" ? Math.max(0, loaded.value.count - closed.length) : 0;
  useEffect(() => {
    onCount(open);
  }, [open, onCount]);

  // The task list below says it is loading; one spinner is enough.
  if (loaded.state === "loading") return null;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const alerts = loaded.value.alerts.filter((alert) => !closed.includes(alert.id));
  const count = loaded.value.count - closed.length;
  if (count <= 0) return null;

  const onClosed = (id: string) => {
    setClosed((was) => [...was, id]);
    // The row is gone, so the keyboard goes to the list's heading rather than to the top of the page.
    heading.current?.focus();
  };
  const groups = Map.groupBy(alerts, (alert) => titleOf(alert.kind));
  return (
    <Panel titleId="needs-a-hand" title={copy.title} count={count} headingRef={heading}>
      {[...groups].map(([title, kind]) => (
        <section key={title} className={styles.group} aria-label={title}>
          <h3 className={styles.groupTitle}>{copy.group(title, kind.length)}</h3>
          <ul className={shared.tasks}>
            {kind.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                maySend={access.reaches(alertNeed(alert.kind, "act"))}
                mayMarkDone={access.reaches(markDoneNeed(alert.kind))}
                onClosed={() => {
                  onClosed(alert.id);
                }}
              />
            ))}
          </ul>
        </section>
      ))}
      {count > alerts.length && <p className={shared.shown}>{copy.shown(alerts.length, count)}</p>}
    </Panel>
  );
}

/** Nothing for a person whose access does not reach any alert, and nothing while none is open. */
export function NeedsAHand({ onCount }: { onCount: (count: number) => void }) {
  const access = useAccess();
  if (!access.mayCall("GET /api/alerts")) return null;
  return <AlertList access={access} onCount={onCount} />;
}
