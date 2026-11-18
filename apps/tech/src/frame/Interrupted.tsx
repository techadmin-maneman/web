// A job ops cancelled, or gave to another technician, while the phone held it (docs/decisions/0246-closed-and-sent-back.md):
// said once, in a dialog over whatever screen is showing, as the prototype words it: whose visit, and when ops did it,
// with a call to ops beside the way back to Today. The banner above every screen (./Banners.tsx) goes on saying it, and
// Pending uploads keeps what was recorded (docs/decisions/0246-closed-and-sent-back.md, decision 8).

import { GLYPHS } from "@maneman/brand/icons";

import { Button, ButtonLink } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { Icon } from "@maneman/ui/Icon";
import { OPS_NUMBER } from "@maneman/web-kit/whatsapp";
import { useLoad, type Loaded } from "@maneman/ui/useLoad";
import { useState } from "react";
import { api, type Alert, type Alerts } from "../api.ts";
import { interrupted as copy, ops } from "../content.ts";
import { jobLabel } from "../lib/kind.ts";
import { useHeldJobs } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { clock, todayInIndia } from "../lib/when.ts";
import { go } from "../route.ts";
import type { Queued } from "../store/outbox.ts";
import styles from "./interrupted.module.css";

/** The jobs already said, for as long as the app is open: Back to Today closes the dialog for that job. */
const said = new Set<string>();

/** A write the API answered with the job cancelled, given to someone else, by whom, or closed. */
const interruption = (event: Queued): boolean =>
  event.state === "superseded" &&
  (event.fields.includes("status") || event.moved !== null || event.note === "already_closed");

/** Whose visit it was: the client by name where the phone knows it, else the job by its time and kind. */
interface Whose {
  readonly name: string | null;
  readonly job: string;
}

/** The time ops did it, where the API said and it was today; null otherwise. */
const timeToday = (at: string | null | undefined): string | null =>
  at === null || at === undefined || todayInIndia(new Date(at)) !== todayInIndia() ? null : clock(at);

/** The dialog's words: whom a job went to, or that it was closed or cancelled; and that what was recorded is kept. */
function wordsOf(event: Queued, whose: Whose): { title: string; body: string } {
  const { name, job } = whose;
  const to = event.moved?.technician ?? null;
  if (to !== null) {
    const title = name === null ? copy.moved(job, to) : copy.movedOf(name, to);
    return { title, body: `${copy.reassignedAt(timeToday(event.moved?.at))} ${copy.kept}` };
  }
  if (event.note === "already_closed") {
    return { title: name === null ? copy.closed(job) : copy.closedOf(name), body: `${copy.closedBody} ${copy.kept}` };
  }
  return {
    title: name === null ? copy.cancelled(job) : copy.cancelledOf(name),
    body: `${copy.cancelledAt(null)} ${copy.kept}`,
  };
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

function alertWords(alert: Alert, whose: Whose): { title: string; body: string } {
  const { name, job } = whose;
  const at = timeToday(alert.sent_at);
  if (alert.kind === "job_reassigned") {
    return { title: name === null ? copy.reassigned(job) : copy.reassignedOf(name), body: copy.reassignedAt(at) };
  }
  return { title: name === null ? copy.cancelled(job) : copy.cancelledOf(name), body: copy.cancelledAt(at) };
}

/** What the dialog says, and of which job: a refused write's, or else an alert's. */
function shownOf(
  event: Queued | undefined,
  alerted: Alert | undefined,
  held: ReturnType<typeof useHeldJobs>,
): { jobId: string; words: { title: string; body: string } } | null {
  if (event !== undefined) {
    const kept = held.get(event.job_id);
    const whose = { name: kept?.client ?? null, job: jobLabel(kept, event.starts_at) };
    return { jobId: event.job_id, words: wordsOf(event, whose) };
  }
  const jobId = alerted?.job_id ?? null;
  if (alerted === undefined || jobId === null) return null;
  const kept = held.get(jobId);
  const whose = { name: alerted.client_name ?? kept?.client ?? null, job: jobLabel(kept, alerted.starts_at ?? "") };
  return { jobId, words: alertWords(alerted, whose) };
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
          <ButtonLink variant="outline" size="action" className={styles.action} href={`tel:+${OPS_NUMBER}`}>
            <Icon d={GLYPHS.phone} size="sm" />
            <span>{ops.call}</span>
          </ButtonLink>
          <Button
            variant="primary"
            size="action"
            className={styles.action}
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
