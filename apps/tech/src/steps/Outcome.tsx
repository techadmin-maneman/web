// Step 6: Done, or Partial with a reason. The reasons are ops', set
// in the console and read with the job, words and all
// (docs/decisions/0087-consumables-and-stock.md); the app invents none and
// sends back the id it was given.
//
// Nothing is chosen for the technician. The board draws Done already chosen,
// in gold beside a gold Next, which let a gloved tap close a job they had not
// finished; here both are outlined until they pick, and Next stays dim until they
// has (ADR 0025, "The technician boards").
//
// The duration runs from Start job to here, and the technician never types a
// time: the phone records the instant this screen's action was taken
// (apps/tech/src/store/jobs.ts).
//
// On a consultation and fit in one visit, Done says what closing it does, by
// the client's choice at the piece step, which no board draws: a client who
// decided against the fit ends with a free consultation and is asked for no
// code; one fitted is texted a payment link for their product, and a discount
// code they give is taken first, unless one is on the visit already
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md, 0108-discount-codes.md).

import { useState } from "react";
import type { EventBody, Job, PartialReason } from "../api.ts";
import { job as jobCopy, oneVisit, steps as copy } from "../content.ts";
import { choiceOf, type ClientChoice } from "../lib/progress.ts";
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

/** The payment link's line: for the product the client chose, by name, or in general where the phone has no choice. */
function linkNote(job: Job, chosen: Extract<ClientChoice, { product: string }> | null): string {
  if (chosen === null) return oneVisit.closeNote;
  const product = job.products.find((one) => one.tier === chosen.product);
  return oneVisit.linkFor(product?.name ?? oneVisit.chosenProduct);
}

/** What closing a one visit as done does: ends it as a free consultation, or texts the client a payment link. */
function OneVisitClose({
  job,
  clientChoice,
  onChecking,
}: {
  job: Job;
  clientChoice: ClientChoice | null;
  onChecking: (checking: boolean) => void;
}) {
  if (clientChoice !== null && "declined" in clientChoice) {
    return <p className={styles.note}>{oneVisit.endsAsConsultation}</p>;
  }
  const standingCode = job.discount_code;
  return (
    <>
      <p className={styles.note}>{linkNote(job, clientChoice)}</p>
      {standingCode === null ? (
        <DiscountCode jobId={job.id} onChecking={onChecking} />
      ) : (
        <p className={styles.note}>{codeSaid(standingCode)}</p>
      )}
    </>
  );
}

/** The choice once the job is in hand: a refused outcome starts as it was chosen. */
function Choosing({
  job,
  clientChoice,
  refused,
  onFinish,
  onBack,
}: {
  job: Job;
  clientChoice: ClientChoice | null;
  refused: Queued | null;
  onFinish: (body: EventBody<"outcome">) => void;
  onBack: () => void;
}) {
  const reasons = job.partial_reasons;
  const offered = reasons.map((one) => one.id);
  const sent = outcomeSent(refused, offered);
  const [choice, setChoice] = useState<Choice>(sent?.choice ?? null);
  const [reason, setReason] = useState<PartialReason["id"] | null>(sent?.reason ?? null);
  const [codeChecking, setCodeChecking] = useState(false);

  const closesOneVisit = job.one_visit && choice === "done";
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

      {closesOneVisit && <OneVisitClose job={job} clientChoice={clientChoice} onChecking={setCodeChecking} />}

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
  const { loaded, retry, refused, queued, finish, back } = useStep(id, "outcome");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} requestId={loaded.requestId} />;
  }
  const job = loaded.value;
  return (
    <Choosing
      job={job}
      clientChoice={choiceOf(job, queued)}
      refused={refused}
      onFinish={(body) => void finish(body)}
      onBack={back}
    />
  );
}
