// Ask ops to reschedule, from the job (docs/prompts/tech-redesign.md, "Job"; docs/decisions/0249-schedule-kit-and-me.md):
// a sheet with why, sent straight with signal; once asked, the card says when and why until ops settle it. A visit
// closed, called off or given away since says so, rather than asking again.

import { Button } from "@maneman/ui/Button";
import { ErrorRef } from "@maneman/ui/ErrorRef";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { TextButton } from "@maneman/ui/TextLink";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useId, useState } from "react";
import { api, type Job } from "../api.ts";
import { reference, reschedule as copy } from "../content.ts";
import { stamp } from "../lib/when.ts";
import { useSession } from "../session.ts";
import styles from "./reschedule.module.css";

type Asked = NonNullable<Job["reschedule_asked"]>;
type Reason = Asked["reason"];

const REASONS = ["client_asked", "running_late", "kit_problem"] as const satisfies readonly Reason[];

/** Why the ask did not go: the visit closed or called off, given away, or any other failure with its reference. */
type Problem = "closed" | "gone" | { readonly requestId: string | null };

function Refused({ problem }: { readonly problem: Problem }) {
  if (problem === "closed") return <p className={styles.failed}>{copy.closed}</p>;
  if (problem === "gone") return <p className={styles.failed}>{copy.gone}</p>;
  return (
    <>
      <p className={styles.failed}>{copy.failed}</p>
      {problem.requestId !== null && <ErrorRef requestId={problem.requestId} words={reference} />}
    </>
  );
}

/** What a refused ask means, by the API's status. */
function problemOf(status: number, requestId: string | null): Problem {
  if (status === 409) return "closed";
  if (status === 404) return "gone";
  return { requestId };
}

function RescheduleSheet(props: {
  readonly jobId: string;
  readonly onAsked: (asked: Asked) => void;
  readonly onClose: () => void;
}) {
  const { offline } = useSession();
  const titleId = useId();
  const [reason, setReason] = useState<Reason | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, once] = useOneAtATime();
  const send = (chosen: Reason) =>
    once(async () => {
      const answer = await api.reschedule(props.jobId, chosen);
      if (answer.ok) props.onAsked(answer.body);
      else setProblem(problemOf(answer.status, answer.requestId));
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
        {problem !== null && (
          <div role="alert">
            <Refused problem={problem} />
          </div>
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

/** The way to ask, on a visit not yet closed; or, once asked, when and why, as the card last said or as just sent. */
export function Reschedule({ job }: { readonly job: Job }) {
  const onCard = job.reschedule_asked;
  const [sent, setSent] = useState<Asked | null>(null);
  const [open, setOpen] = useState(false);
  // A fresher card says where the ask stands: open still, or settled by ops.
  useEffect(() => {
    setSent(null);
  }, [onCard?.asked_at]);
  const asked = onCard ?? sent;
  if (asked !== null) {
    return (
      <p className={styles.asked} role="status">
        {copy.asked(stamp(asked.asked_at), copy.reasons[asked.reason])}
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
            setSent(each);
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
