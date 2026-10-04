// Board D1's second card, one a dispute, in a queue with its count: a charge the client disputed in the app, with
// the evidence its no-show was ruled on, what the charge took, the client's own words, and Refund or Uphold, each
// with a note the server refuses to go without (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). Refund
// gives back what the charge took; the client is told the ruling either way, never the note. A dispute waits on the
// Tasks board too, whose link opens its row here.

import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type DisputeRuling, type NoShowDispute } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { noShows } from "../content.ts";
import { REFUNDING_A_DISPUTE, useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Distance } from "./Distance.tsx";
import styles from "./no-shows.module.css";

const copy = noShows.dispute;

/** Whole minutes from one instant to another. */
const minutesBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 60_000);

function titleOf(each: NoShowDispute): string {
  return each.person === null ? copy.erased : copy.title(each.person.name);
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

/** The board's four rows, in its order. */
function Evidence({ each }: { each: NoShowDispute }) {
  const delivered = each.message_delivered_at;
  const rows = [
    [copy.facts.checkIn, indiaClock(each.checked_in_at)],
    [copy.facts.distance, <Distance key="distance" metres={each.distance_m} radius={each.radius_m} />],
    [
      copy.facts.whatsapp,
      delivered === null ? copy.notDelivered : noShows.queue.message.delivered(indiaClock(delivered)),
    ],
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
        <p className={styles.disputeLabel}>{copy.label}</p>
        <Left due={each.due} now={now} />
      </div>
      <h3 className={styles.disputeTitle} id={titleId}>
        {titleOf(each)}
      </h3>
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
            maxLength={300}
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
          {copy.errors[step.code] ?? copy.errors.unknown}
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
