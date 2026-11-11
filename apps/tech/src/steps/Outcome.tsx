// Step 6: Done, or Partial with one of ops' reasons (docs/decisions/0087-consumables-and-stock.md). Nothing is chosen
// for the technician, so a gloved tap cannot close a job they have not finished (ADR 0025, "The technician boards").
// After a consultation, Done asks whether the client goes ahead (docs/decisions/0149-lost-reasons.md).

import { ToggleButton } from "@maneman/ui/ToggleButton";
import { Field, TextArea } from "@maneman/ui/Field";
import { ALERT_MAX_CHARS, HANDOFF_MAX_CHARS } from "@rules/policy/client-record.ts";
import { useEffect, useState } from "react";
import type { EventBody, Job, OutcomeRequest, PartialReason } from "../api.ts";
import { oneVisit, options, steps as copy, visit } from "../content.ts";
import { choiceOf, type ClientChoice } from "../lib/progress.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { put, remove } from "../store/db.ts";
import type { Queued } from "../store/outbox.ts";
import { DiscountCode } from "./DiscountCode.tsx";
import { useDraft, type Draft } from "./drafts.ts";
import { OptionsPick } from "./OptionsPick.tsx";
import { outcomeSent } from "./sent-before.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import shared from "./steps.module.css";
import styles from "./outcome.module.css";

type Choice = "done" | "partial" | null;

/** What the dim Next says: what is still to choose. */
function stillToChoose(choice: Choice, unanswered: boolean): string {
  if (choice === null) return copy.outcome.choose;
  if (choice === "partial") return copy.outcome.pickReason;
  return unanswered ? copy.outcome.answerFirst : copy.outcome.pickWhy;
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

/** The product a client chose, by name; null where they chose none, or decided against the fit. */
function chosenName(job: Job, choice: ClientChoice | null): string | null {
  if (choice === null || !("product" in choice)) return null;
  return job.products.find((one) => one.tier === choice.product)?.name ?? null;
}

/**
 * A done close, with what the client said where they were asked: a yes, with the product a consultation's client
 * picked on Options, or a no and the reason picked, which a fit the client declined may leave unpicked.
 */
function doneOf(
  asked: boolean,
  notGoingAhead: boolean,
  lost: string | null,
  choice: ClientChoice | null,
): OutcomeRequest {
  if (!asked) return { outcome: "done" };
  if (!notGoingAhead) {
    const picked = choice !== null && "product" in choice ? { product: choice.product } : {};
    return { outcome: "done", going_ahead: true, ...picked };
  }
  return lost === null
    ? { outcome: "done", going_ahead: false }
    : { outcome: "done", lost_reason: lost, going_ahead: false };
}

/**
 * What the close leaves on the client's record (docs/prompts/tech-redesign.md, "Outcome"): a note for whoever takes the
 * client's next visit, and an alert read before every visit. Each goes with the close only when written; a refused
 * close starts from what it said.
 */
function useCloseNotes(sent: { readonly note: string; readonly alert: string } | null) {
  const [note, setNote] = useState(sent?.note ?? "");
  const [alert, setAlert] = useState(sent?.alert ?? "");
  const add = (body: OutcomeRequest): OutcomeRequest => ({
    ...body,
    ...(note.trim() === "" ? {} : { handoff_note: note.trim() }),
    ...(alert.trim() === "" ? {} : { client_alert: alert.trim() }),
  });
  const fields = (
    <div className={styles.notes}>
      <Field label={copy.outcome.nextNote}>
        {(control) => (
          <TextArea
            {...control}
            maxLength={HANDOFF_MAX_CHARS}
            value={note}
            onChange={(event) => {
              setNote(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.outcome.alert} hint={copy.outcome.alertHint}>
        {(control) => (
          <TextArea
            {...control}
            rows={2}
            maxLength={ALERT_MAX_CHARS}
            value={alert}
            onChange={(event) => {
              setAlert(event.currentTarget.value);
            }}
          />
        )}
      </Field>
    </div>
  );
  return { add, fields };
}

/** After a consultation: whether the client is going ahead with a fit, and with a yes, what they picked on Options. */
function GoingAhead(props: { answer: boolean | null; pickedName: string | null; onAnswer: (value: boolean) => void }) {
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
      {props.answer === true && props.pickedName !== null && (
        <p className={shared.note}>{copy.outcome.picked(props.pickedName)}</p>
      )}
    </>
  );
}

/**
 * The choice once the job is in hand: a refused outcome starts as it was chosen. What the client chose is a one visit's
 * decision at the hair system, or the product a consultation's client picked on Options, which goes with a yes.
 */
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
  const notes = useCloseNotes(sent);

  const closesOneVisit = job.one_visit && choice === "done";
  const declined = clientChoice !== null && "declined" in clientChoice;
  const asksWhy = job.lost_reasons.length > 0 && choice === "done" && (!job.one_visit || declined);
  const notGoingAhead = asksWhy && (declined || goingAhead === false);
  // Not now asks why; a fit the client declined offers the reasons, to pick or leave.
  const mustSayWhy = notGoingAhead && !declined;
  // After a consultation the question must be answered: an unanswered one is never recorded as a yes.
  const unanswered = asksWhy && !job.one_visit && goingAhead === null;
  // A code being checked would change the link closing the visit sends: Next waits for it.
  const doneReady = !unanswered && (!mustSayWhy || lost !== null);
  const ready = !codeChecking && (choice === "done" ? doneReady : choice === "partial" && reason !== null);
  // The words follow the choice: a one visit closed as done sends the client its payment link.
  const sendsLink = closesOneVisit && !declined;

  return (
    <StepFrame
      title={copy.titles.outcome}
      action={sendsLink ? copy.outcome.sendLinkAndClose : undefined}
      ready={ready}
      unfinished={stillToChoose(choice, unanswered)}
      notice={refused === null ? null : copy.corrected.other}
      onBack={onBack}
      onAction={() => {
        if (choice === "partial" && reason !== null) onFinish(notes.add({ outcome: "partial", reason }));
        else onFinish(notes.add(doneOf(asksWhy, notGoingAhead, lost, clientChoice)));
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
          pickedName={chosenName(job, clientChoice)}
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
      {choice !== null && notes.fields}
    </StepFrame>
  );
}

/** The product a refused close picked, so putting it right starts from it; null for none. */
function pickSent(refused: Queued | null): string | null {
  const sent = refused?.body as { product?: unknown } | null | undefined;
  return typeof sent?.product === "string" ? sent.product : null;
}

/**
 * A consultation's outcome, which opens on its Options (docs/decisions/0247-the-steps-left.md): the pick is kept on the
 * phone as it is made and goes with a yes, while the product is still on the card. A refused close opens on the close.
 */
function ConsultationOutcome({
  job,
  refused,
  draft,
  onFinish,
  onBack,
}: {
  job: Job;
  refused: Queued | null;
  draft: Draft<"options_draft"> | null;
  onFinish: (body: EventBody<"outcome">) => void;
  onBack: () => void;
}) {
  const [page, setPage] = useState<"options" | "close">(refused === null ? "options" : "close");
  const [picked, setPicked] = useState<string | null>(() => pickSent(refused) ?? draft?.picked ?? null);

  // Kept as made: a full phone loses the pick, never the step.
  useEffect(() => {
    if (picked !== null) put("device", { key: "options_draft", job_id: job.id, picked }).catch(() => undefined);
  }, [job.id, picked]);

  if (page === "options") {
    return (
      <StepFrame
        key="options"
        title={options.title}
        action={visit.next(copy.titles.outcome)}
        ready
        onBack={onBack}
        onAction={() => {
          setPage("close");
        }}
      >
        <OptionsPick job={job} picked={picked} onPick={setPicked} />
      </StepFrame>
    );
  }
  const offered = job.products.some((one) => one.tier === picked);
  return (
    <Choosing
      key="close"
      job={job}
      clientChoice={picked !== null && offered ? { product: picked } : null}
      refused={refused}
      onFinish={(body) => {
        remove("device", "options_draft").catch(() => undefined);
        onFinish(body);
      }}
      onBack={() => {
        setPage("options");
      }}
    />
  );
}

export function Outcome({ id }: { id: string }) {
  const { loaded, retry, refused, queued, finish, back } = useStep(id, "outcome");
  const kept = useDraft("options_draft", id);

  if (loaded.state === "loading" || !kept.read) return <Loading />;
  if (loaded.state === "failed") {
    return <JobFailed failed={loaded} onRetry={retry} />;
  }
  const job = loaded.value;
  if (job.type === "consultation" && !job.one_visit) {
    return (
      <ConsultationOutcome
        job={job}
        refused={refused}
        draft={kept.draft}
        onFinish={(body) => void finish(body)}
        onBack={back}
      />
    );
  }
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
