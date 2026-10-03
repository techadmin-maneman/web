// Tasks' "Needs a hand": the alerts ops were told of in the alert space, each until somebody puts right what it was
// about (src/routes/ops-alerts.ts). Each says what happened and links to where to act; ops mark one done, or send
// again the message, lead or CRM erasure it gave up on. Each person sees their own departments' kinds.

import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import { api, type OpenAlert } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { needsAHand as copy } from "../content.ts";
import { alertNeed, useAccess, type Access } from "../lib/access.ts";
import { PanelFailed } from "../states/States.tsx";
import styles from "./tasks.module.css";

/** The few words that name what went wrong. */
function titleOf(kind: string): string {
  const named = copy.kinds[kind];
  if (named !== undefined) return named;
  return kind.startsWith("books_") ? copy.books : copy.other;
}

type Action = "send" | "done";

function AlertRow({ alert, mayAct, onClosed }: { alert: OpenAlert; mayAct: boolean; onClosed: () => void }) {
  const [busy, once] = useOneAtATime();
  const [acting, setActing] = useState<Action | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const title = titleOf(alert.kind);

  const act = (action: Action) =>
    once(async () => {
      setActing(action);
      setFailed(null);
      const answer = action === "send" ? await api.sendAlertAgain(alert.id) : await api.resolveAlert(alert.id);
      setActing(null);
      if (answer.ok) onClosed();
      else setFailed(answer.code);
    });

  return (
    <li className={styles.alert}>
      <div className={styles.what}>
        <span className={styles.subject}>{title}</span>
        <span className={styles.sub}>{alert.message}</span>
        {alert.kind === "message_failed" && <span className={styles.sub}>{copy.messageHint}</span>}
        <span className={styles.acts}>
          {alert.link !== null && (
            <OpsLink className={styles.decide} to={alert.link}>
              {copy.open}
              <VisuallyHidden>{` · ${title}`}</VisuallyHidden>
            </OpsLink>
          )}
          {mayAct && alert.send_again && (
            <button type="button" className={styles.act} disabled={busy} onClick={() => void act("send")}>
              {acting === "send" ? copy.sending : copy.sendAgain}
              <VisuallyHidden>{` · ${title}`}</VisuallyHidden>
            </button>
          )}
          {mayAct && (
            <button type="button" className={styles.act} disabled={busy} onClick={() => void act("done")}>
              {acting === "done" ? copy.closing : copy.done}
              <VisuallyHidden>{` · ${title}`}</VisuallyHidden>
            </button>
          )}
        </span>
        {failed !== null && (
          <span className={styles.error} role="alert">
            {copy.errors[failed] ?? copy.errors.unknown}
          </span>
        )}
      </div>
      <span className={styles.sla}>{copy.seen(alert.count, shortDate(indiaDate(alert.told_at)))}</span>
    </li>
  );
}

function AlertList({ access }: { access: Access }) {
  const [loaded, retry] = useLoad(api.alerts);
  const [closed, setClosed] = useState<readonly string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);

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
  return (
    <section className={styles.panel} aria-labelledby="needs-a-hand">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="needs-a-hand" ref={heading} tabIndex={-1}>
          {copy.title}
        </h2>
        <span className={styles.count}>{count}</span>
      </div>
      <ul className={styles.tasks}>
        {alerts.map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            mayAct={access.reaches(alertNeed(alert.kind, "act"))}
            onClosed={() => {
              onClosed(alert.id);
            }}
          />
        ))}
      </ul>
      {count > alerts.length && <p className={styles.shown}>{copy.shown(alerts.length, count)}</p>}
    </section>
  );
}

/** Nothing for a person whose access does not reach any alert, and nothing while none is open. */
export function NeedsAHand() {
  const access = useAccess();
  if (!access.mayCall("GET /api/alerts")) return null;
  return <AlertList access={access} />;
}
