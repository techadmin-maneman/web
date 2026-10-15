// Step 6: Done, or Partial with one of ops' reasons (docs/decisions/0087-consumables-and-stock.md). Nothing is chosen
// for the technician, so a gloved tap cannot close a job they have not finished (ADR 0025, "The technician boards").
// After a consultation, Done asks whether the client goes ahead (docs/decisions/0149-lost-reasons.md).

import { ToggleButton } from "@maneman/ui/ToggleButton";
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
import shared from "./steps.module.css";
import styles from "./outcome.module.css";

type Choice = "done" | "partial" | null;

/** What the dim Next says: what is still to choose. */
function stillToChoose(choice: Choice): string {
  if (choice === null) return copy.outcome.choose;
  return choice === "done" ? copy.outcome.pickWhy : copy.outcome.pickReason;
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
    return <p className={shared.note}>{oneVisit.endsAsConsultation}</p>;
  }
  const standingCode = job.discount_code;
  return (
    <>
      <p className={shared.note}>{linkNote(job, clientChoice)}</p>
      {standingCode === null ? (
        <DiscountCode jobId={job.id} onChecking={onChecking} />
      ) : (
        <p className={shared.note}>{codeSaid(standingCode)}</p>
      )}
    </>
  );
}

/** Two outlined buttons, one of which may be chosen. */
function Pair<T extends string | boolean>(props: {
  options: readonly [{ value: T; label: string }, { value: T; label: string }];
  chosen: T | null;
  onChoose: (value: T) => void;
}) {
  return (
    <div className={shared.choices}>
      {props.options.map((option) => (
        <ToggleButton
          key={String(option.value)}
          onInk
          className={shared.choice}
          pressed={props.chosen === option.value}
          onClick={() => {
            props.onChoose(option.value);
          }}
        >
          {option.label}
        </ToggleButton>
      ))}
    </div>
  );
}

/** Ops' reasons, one to a row, one of which may be picked. */
function ReasonList(props: { reasons: Job["partial_reasons"]; picked: string | null; onPick: (id: string) => void }) {
  return (
    <ul className={shared.reasons}>
      {props.reasons.map((one) => (
        <li key={one.id}>
          <ToggleButton
            onInk
            className={styles.reason}
            pressed={props.picked === one.id}
            onClick={() => {
              props.onPick(one.id);
            }}
          >
            {one.label}
          </ToggleButton>
        </li>
      ))}
    </ul>
  );
}

/** After a consultation: whether the client is going ahead with a fit. */
function GoingAhead(props: { answer: boolean | null; onAnswer: (value: boolean) => void }) {
  return (
    <>
      <p className={shared.note}>{copy.outcome.goingAhead}</p>
      <Pair<boolean>
        options={[
          { value: true, label: copy.outcome.yes },
          { value: false, label: copy.outcome.notNow },
        ]}
        chosen={props.answer}
        onChoose={props.onAnswer}
      />
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
  const sent = outcomeSent(
    refused,
    job.partial_reasons.map((one) => one.id),
  );
  const [choice, setChoice] = useState<Choice>(sent?.choice ?? null);
  const [reason, setReason] = useState<PartialReason["id"] | null>(sent?.reason ?? null);
  const [codeChecking, setCodeChecking] = useState(false);
  const [goingAhead, setGoingAhead] = useState<boolean | null>(null);
  const [lost, setLost] = useState<string | null>(null);

  const closesOneVisit = job.one_visit && choice === "done";
  const declined = clientChoice !== null && "declined" in clientChoice;
  const asksWhy = job.lost_reasons.length > 0 && choice === "done" && (!job.one_visit || declined);
  const notGoingAhead = asksWhy && (declined || goingAhead === false);
  // Not now asks why; a fit the client declined offers the reasons, to pick or leave.
  const mustSayWhy = notGoingAhead && !declined;
  // A code being checked would change the link closing the visit sends: Next waits for it.
  const ready =
    !codeChecking && (choice === "done" ? !mustSayWhy || lost !== null : choice === "partial" && reason !== null);

  return (
    <StepFrame
      title={copy.titles.outcome}
      action={copy.next}
      ready={ready}
      unfinished={stillToChoose(choice)}
      notice={refused === null ? null : copy.corrected.other}
      onBack={onBack}
      onAction={() => {
        if (choice === "partial" && reason !== null) onFinish({ outcome: "partial", reason });
        else onFinish(notGoingAhead && lost !== null ? { outcome: "done", lost_reason: lost } : { outcome: "done" });
      }}
    >
      <Pair<"done" | "partial">
        options={[
          { value: "done", label: copy.outcome.done },
          { value: "partial", label: copy.outcome.partial },
        ]}
        chosen={choice}
        onChoose={(value) => {
          setChoice(value);
          setReason(null);
          setGoingAhead(null);
          setLost(null);
        }}
      />
      {closesOneVisit && <OneVisitClose job={job} clientChoice={clientChoice} onChecking={setCodeChecking} />}
      {asksWhy && !job.one_visit && (
        <GoingAhead
          answer={goingAhead}
          onAnswer={(value) => {
            setGoingAhead(value);
            setLost(null);
          }}
        />
      )}
      {notGoingAhead && (
        <>
          <p className={shared.note}>{copy.outcome.why}</p>
          <ReasonList reasons={job.lost_reasons} picked={lost} onPick={setLost} />
        </>
      )}
      {choice === "partial" && <ReasonList reasons={job.partial_reasons} picked={reason} onPick={setReason} />}
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
