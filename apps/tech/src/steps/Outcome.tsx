// Board B4, step 6: Done, or Partial with a reason. The reasons are ops', set
// in the console and read with the job, words and all
// (docs/decisions/0087-consumables-and-stock.md); the app invents none and
// sends back the id it was given.
//
// Nothing is chosen for the technician. The board draws Done already chosen,
// in gold beside a gold Next, which let a gloved tap close a job he had not
// finished; here both are outlined until he picks, and Next stays dim until he
// has (ADR 0025, "The technician boards").
//
// The duration runs from Start job to here, and the technician never types a
// time: the phone records the instant this screen's action was taken
// (apps/tech/src/store/jobs.ts).
//
// On a consultation and fit in one visit, Done says what closing it does, which
// no board draws: the client is texted a payment link for the product they
// chose, or the visit ends as a consultation (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md), and
// takes a discount code the client gives, before the link goes, unless one is on the visit already
// (docs/decisions/0108-discount-codes.md).

import { useState } from "react";
import type { Job, PartialReason } from "../api.ts";
import { job as jobCopy, oneVisit, steps as copy } from "../content.ts";
import { Failed, Loading } from "../states/States.tsx";
import type { Queued } from "../store/outbox.ts";
import { DiscountCode } from "./DiscountCode.tsx";
import { outcomeSent } from "./sent-before.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

type Choice = "done" | "partial" | null;

/** What the dim Next says: what is still to choose. */
function stillToChoose(choice: Choice): string {
  return choice === null ? copy.outcome.choose : copy.outcome.pickReason;
}

/** The code already on the one visit, in place of the box to type one in. */
function codeSaid(code: NonNullable<Job["discount_code"]>): string {
  return code.given_by === "technician" ? oneVisit.code.applied(code.code) : oneVisit.code.appliedAtBooking(code.code);
}

/** The choice once the job is in hand: a refused outcome starts as it was chosen. */
function Choosing({
  job,
  refused,
  onFinish,
  onBack,
}: {
  job: Job;
  refused: Queued | null;
  onFinish: (body: unknown) => void;
  onBack: () => void;
}) {
  const reasons = job.partial_reasons;
  const offered = reasons.map((one) => one.id);
  const sent = outcomeSent(refused, offered);
  const [choice, setChoice] = useState<Choice>(sent?.choice ?? null);
  const [reason, setReason] = useState<PartialReason["id"] | null>(sent?.reason ?? null);
  const [codeChecking, setCodeChecking] = useState(false);

  const closesOneVisit = job.one_visit && choice === "done";
  const standingCode = job.discount_code;
  // A code being checked would change the link closing the visit sends: Next waits for it.
  const ready = !codeChecking && (choice === "done" || (choice === "partial" && reason !== null));

  return (
    <StepFrame
      title={copy.titles.outcome}
      action={copy.next}
      ready={ready}
      unfinished={stillToChoose(choice)}
      notice={refused === null ? null : copy.corrected.other}
      onBack={onBack}
      onAction={() => {
        onFinish(choice === "partial" && reason !== null ? { outcome: "partial", reason } : { outcome: "done" });
      }}
    >
      <div className={styles.choices}>
        <button
          className={choice === "done" ? styles.choiceOn : styles.choice}
          type="button"
          aria-pressed={choice === "done"}
          onClick={() => {
            setChoice("done");
            setReason(null);
          }}
        >
          {copy.outcome.done}
        </button>
        <button
          className={choice === "partial" ? styles.choiceOn : styles.choice}
          type="button"
          aria-pressed={choice === "partial"}
          onClick={() => {
            setChoice("partial");
          }}
        >
          {copy.outcome.partial}
        </button>
      </div>

      {closesOneVisit && <p className={styles.note}>{oneVisit.closeNote}</p>}
      {closesOneVisit && standingCode === null && <DiscountCode jobId={job.id} onChecking={setCodeChecking} />}
      {closesOneVisit && standingCode !== null && <p className={styles.note}>{codeSaid(standingCode)}</p>}

      {choice === "partial" && (
        <ul className={styles.reasons}>
          {reasons.map((one) => (
            <li key={one.id}>
              <button
                className={reason === one.id ? styles.reasonOn : styles.reason}
                type="button"
                aria-pressed={reason === one.id}
                onClick={() => {
                  setReason(one.id);
                }}
              >
                {one.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </StepFrame>
  );
}

export function Outcome({ id }: { id: string }) {
  const { loaded, retry, refused, finish, back } = useStep(id, "outcome");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} requestId={loaded.requestId} />;
  }
  return <Choosing job={loaded.value} refused={refused} onFinish={(body) => void finish(body)} onBack={back} />;
}
