// Ask ops to reschedule, from the job (docs/prompts/tech-redesign.md, "Job"; docs/decisions/0249-schedule-kit-and-me.md):
// a sheet with why, sent straight with signal; once asked, the card says when and why until ops settle it.

import { Button } from "@maneman/ui/Button";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { TextButton } from "@maneman/ui/TextLink";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useId, useState } from "react";
import { api, type Job } from "../api.ts";
import { reschedule as copy } from "../content.ts";
import { clock } from "../lib/when.ts";
import { useSession } from "../session.ts";
import styles from "./reschedule.module.css";

type Asked = NonNullable<Job["reschedule_asked"]>;
type Reason = Asked["reason"];

const REASONS = ["client_asked", "running_late", "kit_problem"] as const satisfies readonly Reason[];

function RescheduleSheet(props: {
  readonly jobId: string;
  readonly onAsked: (asked: Asked) => void;
  readonly onClose: () => void;
}) {
  const { offline } = useSession();
  const titleId = useId();
  const [reason, setReason] = useState<Reason | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, once] = useOneAtATime();
  const send = (chosen: Reason) =>
    once(async () => {
      const answer = await api.reschedule(props.jobId, chosen);
      setFailed(!answer.ok);
      if (answer.ok) props.onAsked(answer.body);
    });
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={props.onClose}>
      <SheetClose onClose={props.onClose}>{copy.close}</SheetClose>
      <SheetPanel className={styles.panel}>
        <h2 className={styles.title} id={titleId}>
          {copy.open}
        </h2>
        <div className={styles.reasons} role="group" aria-label={copy.why}>
          {REASONS.map((each) => (
            <ToggleButton
              key={each}
              pressed={reason === each}
              onClick={() => {
                setReason(each);
              }}
            >
              {copy.reasons[each]}
            </ToggleButton>
          ))}
        </div>
        {failed && (
          <p className={styles.failed} role="alert">
            {copy.failed}
          </p>
        )}
        {reason !== null && (
          <Button variant="primary" size="action" busy={busy} disabled={offline} onClick={() => void send(reason)}>
            {offline ? copy.needsSignal : copy.send}
          </Button>
        )}
      </SheetPanel>
    </Sheet>
  );
}

/** The way to ask, on a visit not yet closed; or, once asked, when and why. */
export function Reschedule({ job }: { readonly job: Job }) {
  const [asked, setAsked] = useState<Asked | null>(job.reschedule_asked);
  const [open, setOpen] = useState(false);
  if (asked !== null) {
    return (
      <p className={styles.asked} role="status">
        {copy.asked(clock(asked.asked_at), copy.reasons[asked.reason])}
      </p>
    );
  }
  if (job.progress.outcome !== null) return null;
  return (
    <>
      <TextButton
        className={styles.ask}
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.open}
      </TextButton>
      {open && (
        <RescheduleSheet
          jobId={job.id}
          onAsked={(each) => {
            setAsked(each);
            setOpen(false);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
