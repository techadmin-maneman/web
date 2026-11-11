// A job ops cancelled, or gave to another technician, while the phone held it (docs/decisions/0246-closed-and-sent-back.md):
// said once, in a dialog over whatever screen is showing, with a call to ops and the way back to Today. The banner
// above every screen (./Banners.tsx) goes on saying it, and Pending uploads keeps what was recorded.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { OPS_NUMBER } from "@maneman/web-kit/whatsapp";
import { useState } from "react";
import { interrupted as copy, ops } from "../content.ts";
import { jobLabel } from "../lib/kind.ts";
import { useHeldJobs } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { go } from "../route.ts";
import type { Queued } from "../store/outbox.ts";
import styles from "./interrupted.module.css";

/** The jobs already said, for as long as the app is open: Back to Today closes the dialog for that job. */
const said = new Set<string>();

/** A write the API answered with the job cancelled, or given to someone else, by whom. */
const interruption = (event: Queued): boolean =>
  event.state === "superseded" && (event.fields.includes("status") || event.moved !== null);

export function Interrupted() {
  const waiting = useOutbox();
  const held = useHeldJobs(waiting);
  const [, setSaid] = useState(0);
  const event = waiting.events.find((one) => interruption(one) && !said.has(one.job_id));
  if (event === undefined) return null;

  const job = jobLabel(held.get(event.job_id), event.starts_at);
  const to = event.moved?.technician ?? null;
  const close = () => {
    said.add(event.job_id);
    setSaid(said.size);
  };
  return (
    <Dialog labelledBy="interrupted-title" className={styles.dialog} canClose={false} onDismiss={close}>
      {/* The dialog opens above every screen's own look, so it carries the new look itself. */}
      <div className={styles.panel} data-look="light">
        <h2 className={styles.title} id="interrupted-title">
          {to === null ? copy.cancelled(job) : copy.moved(job, to)}
        </h2>
        <p className={styles.body}>{to === null ? copy.cancelledBody : copy.movedBody(to)}</p>
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
