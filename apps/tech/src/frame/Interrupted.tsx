// A job ops cancelled, or gave to another technician, while the phone held it (docs/decisions/0246-closed-and-sent-back.md):
// said once, in a dialog over whatever screen is showing, with a call to ops and the way back to Today. The banner
// above every screen (./Banners.tsx) goes on saying it, and Pending uploads keeps what was recorded.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { OPS_NUMBER } from "@maneman/web-kit/whatsapp";
import { useLoad, type Loaded } from "@maneman/ui/useLoad";
import { useState } from "react";
import { api, type Alert, type Alerts } from "../api.ts";
import { interrupted as copy, ops } from "../content.ts";
import { jobLabel } from "../lib/kind.ts";
import { useHeldJobs } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { todayInIndia } from "../lib/when.ts";
import { go } from "../route.ts";
import type { Queued } from "../store/outbox.ts";
import styles from "./interrupted.module.css";

/** The jobs already said, for as long as the app is open: Back to Today closes the dialog for that job. */
const said = new Set<string>();

/** A write the API answered with the job cancelled, given to someone else, by whom, or closed. */
const interruption = (event: Queued): boolean =>
  event.state === "superseded" &&
  (event.fields.includes("status") || event.moved !== null || event.note === "already_closed");

/** The dialog's words: whom a job went to, or that it was closed or cancelled. */
function wordsOf(event: Queued, job: string): { title: string; body: string } {
  const to = event.moved?.technician ?? null;
  if (to !== null) return { title: copy.moved(job, to), body: copy.movedBody(to) };
  if (event.note === "already_closed") return { title: copy.closed(job), body: copy.closedBody };
  return { title: copy.cancelled(job), body: copy.cancelledBody };
}

/**
 * A job of today's the API says was called off or given to another, from an alert not yet read: a push read with the
 * app open (docs/decisions/0250-guides-and-alerts.md).
 */
function alertedOf(loaded: Loaded<Alerts>, today: string): Alert | undefined {
  if (loaded.state !== "loaded") return undefined;
  const changes = new Set(["job_cancelled", "job_reassigned"]);
  return loaded.value.alerts.find(
    (alert) =>
      !alert.read &&
      changes.has(alert.kind) &&
      alert.date === today &&
      alert.job_id !== null &&
      !said.has(alert.job_id),
  );
}

function alertWords(alert: Alert, job: string): { title: string; body: string } {
  if (alert.kind === "job_reassigned") return { title: copy.reassigned(job), body: copy.reassignedBody };
  return { title: copy.cancelled(job), body: copy.cancelledAlert };
}

/** What the dialog says, and of which job: a refused write's, or else an alert's. */
function shownOf(
  event: Queued | undefined,
  alerted: Alert | undefined,
  held: ReturnType<typeof useHeldJobs>,
): { jobId: string; words: { title: string; body: string } } | null {
  if (event !== undefined) {
    return { jobId: event.job_id, words: wordsOf(event, jobLabel(held.get(event.job_id), event.starts_at)) };
  }
  const jobId = alerted?.job_id ?? null;
  if (alerted === undefined || jobId === null) return null;
  const job = alerted.client_name ?? jobLabel(held.get(jobId), alerted.starts_at ?? "");
  return { jobId, words: alertWords(alerted, job) };
}

export function Interrupted() {
  const waiting = useOutbox();
  const held = useHeldJobs(waiting);
  const [alerts] = useLoad(api.alerts);
  const [, setSaid] = useState(0);
  const event = waiting.events.find((one) => interruption(one) && !said.has(one.job_id));
  const alerted = event === undefined ? alertedOf(alerts, todayInIndia()) : undefined;
  const shown = shownOf(event, alerted, held);
  if (shown === null) return null;

  const { jobId, words } = shown;
  const close = () => {
    said.add(jobId);
    setSaid(said.size);
  };
  return (
    <Dialog labelledBy="interrupted-title" className={styles.dialog} canClose={false} onDismiss={close}>
      {/* The dialog opens above every screen's own look, so it carries the new look itself. */}
      <div className={styles.panel} data-look="light">
        <h2 className={styles.title} id="interrupted-title">
          {words.title}
        </h2>
        <p className={styles.body}>{words.body}</p>
        <div className={styles.actions}>
          <ButtonLink variant="outline" size="action" href={`tel:+${OPS_NUMBER}`}>
            {ops.call}
          </ButtonLink>
          <Button
            variant="primary"
            size="action"
            onClick={() => {
              close();
              go("/");
            }}
          >
            {copy.today}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
