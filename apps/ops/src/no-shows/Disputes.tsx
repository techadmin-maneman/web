// The Payments page's second card, one a dispute, in a queue with its count: a charge the client disputed in the app, with
// the evidence its no-show was ruled on, what the charge took, the client's own words, and Refund or Uphold, each
// with a note the server refuses to go without (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). Refund
// gives back what the charge took; the client is told the ruling either way, never the note. A dispute waits on the
// Tasks board too, whose link opens its row here.

import { REASON_MAX_CHARS } from "../../../../src/policy/decision-reasons.ts";
import { errorText } from "@maneman/web-kit/refusal";
import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, minutesBetween, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type DisputeRuling, type NoShowDispute } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { Reach } from "../components/Reach.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { noShows } from "../content.ts";
import { REFUNDING_A_DISPUTE, useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { clientPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Distance } from "./Distance.tsx";
import styles from "./no-shows.module.css";

const copy = noShows.dispute;

/** Whole minutes from one instant to another. */

/** "Vikram Sethi disputes the charge", his name opening his visits. */
function Title({ person }: { person: NoShowDispute["person"] }) {
  if (person === null) return copy.erased;
  return (
    <>
      <OpsLink className={styles.disputeName} to={clientPath(person.id, "visits")}>
        {person.name}
      </OpsLink>{" "}
      {copy.title}
    </>
  );
}

/** "The charge kept Rs. 4,000, for the visit of Sat 19 Sep", or the credit it spent. */
function tookOf(each: NoShowDispute): string {
  const what = each.kept > 0 ? rupees(each.kept) : copy.credit;
  const day = each.window_start === null ? noShows.queue.noDay : shortDate(indiaDate(each.window_start));
  return copy.took(what, day);
}

function waitedOf(each: NoShowDispute): string {
  if (each.closed_at === null) return noShows.queue.notClosed;
  return noShows.queue.waited(minutesBetween(each.checked_in_at, each.closed_at), indiaClock(each.closed_at));
}

/** Whether the reminder reached the client, was sent and never delivered, or never went at all. */
function messageOf(each: NoShowDispute): string {
  const lines = noShows.queue.message;
  if (each.message_delivered_at !== null) return lines.delivered(indiaClock(each.message_delivered_at));
  if (each.message_state === "delivered") return lines.sent;
  return lines[each.message_state];
}

/** The check-in's time, and the phone's own where the bounds moved it (src/policy/phone-clock.ts). */
function checkInOf(each: NoShowDispute): string {
  const at = indiaClock(each.checked_in_at);
  const said = each.phone_checked_in_at;
  if (said === null || said.slice(0, 16) === each.checked_in_at.slice(0, 16)) return at;
  const sameDay = indiaDate(said) === indiaDate(each.checked_in_at);
  return copy.adjusted(at, sameDay ? indiaClock(said) : `${shortDate(indiaDate(said))}, ${indiaClock(said)}`);
}

/** The board's four rows, in its order. */
function Evidence({ each }: { each: NoShowDispute }) {
  const rows = [
    [copy.facts.checkIn, checkInOf(each)],
    [copy.facts.distance, <Distance key="distance" metres={each.distance_m} radius={each.radius_m} />],
    [copy.facts.whatsapp, messageOf(each)],
    [copy.facts.waited, waitedOf(each)],
  ] as const;
  return (
    <dl className={styles.facts}>
      {rows.map(([name, value]) => (
        <div className={styles.fact} key={name}>
          <dt className={styles.factName}>{name}</dt>
          <dd className={styles.factValue}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Step =
  { readonly kind: "open" } | { readonly kind: "sending" } | { readonly kind: "failed"; readonly code: string };

/** What the person's access lets them do with a dispute: uphold the charge, and refund it, which gives money back. */
interface MayRule {
  readonly uphold: boolean;
  readonly refund: boolean;
}

interface DisputeProps {
  readonly each: NoShowDispute;
  readonly now: Date;
  readonly may: MayRule;
  readonly onRuled: () => void;
}

function Dispute({ each, now, may, onRuled }: DisputeProps) {
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<Step>({ kind: "open" });

  const rule = async (ruling: DisputeRuling) => {
    setStep({ kind: "sending" });
    const answer = await api.ruleOnDispute(each.id, ruling, reason.trim());
    if (answer.ok) onRuled();
    else setStep({ kind: "failed", code: answer.code });
  };

  const sending = step.kind === "sending";
  const noReason = reason.trim() === "";
  // Not "dispute-…", which is the queue row's own id, and the address a task links to.
  const titleId = `dispute-title-${each.id}`;
  return (
    <section aria-labelledby={titleId}>
      <div className={styles.caseHead}>
        <p className={capsLook(styles.disputeLabel)}>{copy.label}</p>
        <Left due={each.due} now={now} />
      </div>
      <h3 className={styles.disputeTitle} id={titleId}>
        <Title person={each.person} />
      </h3>
      {each.person !== null && <Reach name={each.person.name} mobile={each.person.mobile} />}
      {each.reason === null ? (
        <p className={styles.disputeWords}>{copy.wordsErased}</p>
      ) : (
        <blockquote className={styles.disputeWords}>{each.reason}</blockquote>
      )}
      <p className={styles.caseSub}>{tookOf(each)}</p>
      <Evidence each={each} />
      {may.uphold && (
        <>
          <label className={styles.reasonLabel} htmlFor={`ruling-${each.id}`}>
            {copy.reason.label}
          </label>
          <textarea
            id={`ruling-${each.id}`}
            className={styles.reasonField}
            maxLength={REASON_MAX_CHARS}
            placeholder={copy.reason.placeholder}
            aria-describedby={`ruling-hint-${each.id}`}
            value={reason}
            disabled={sending}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <p className={styles.reasonHint} id={`ruling-hint-${each.id}`}>
            {copy.reason.hint}
          </p>
          <div className={styles.actions} role="group" aria-label={copy.ruling}>
            {may.refund && (
              <Button
                variant="primary"
                size="small"
                className={styles.charge}
                disabled={sending || noReason}
                onClick={() => void rule("refunded")}
              >
                {copy.refund}
              </Button>
            )}
            <Button
              variant="outline"
              size="small"
              className={styles.waive}
              disabled={sending || noReason}
              onClick={() => void rule("upheld")}
            >
              {copy.uphold}
            </Button>
          </div>
        </>
      )}
      {step.kind === "failed" && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, { code: step.code })}
        </p>
      )}
    </section>
  );
}

/** `onRuled`: a dispute was ruled on, which may have refunded money today. */
export function Disputes({ onRuled }: { onRuled: () => void }) {
  const [loaded, retry] = useLoad(api.disputes);
  const access = useAccess();
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date();
  const uphold = access.mayCall("POST /api/no-shows/disputes/{id}/ruling");
  const may: MayRule = { uphold, refund: uphold && access.reaches(REFUNDING_A_DISPUTE) };
  return (
    <DecisionQueue
      titleId="disputes"
      title={copy.queueTitle}
      items={loaded.value.disputes}
      rowKind="dispute"
      empty={copy.none}
    >
      {(each, ruled) => (
        <Dispute
          each={each}
          now={now}
          may={may}
          onRuled={() => {
            ruled();
            onRuled();
          }}
        />
      )}
    </DecisionQueue>
  );
}
