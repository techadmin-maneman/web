// No-shows (Ops Console, board D1): the day's money over the charges it was
// kept on, then each case with the evidence ops rule on, charged or waived
// here. The board's second card is a disputed charge; nothing records a dispute
// and no client can raise one, so it is a line between the two and not a card
// (docs/open-points.md, item 57).
//
// A case is evidence a client may be charged on, so it names the client and
// says when the visit was booked for, when the technician's phone says he
// arrived and when that reached us, and what became of the reminder. A ruling
// carries its reason, which the server refuses to go without, and a charge is
// asked about once more before it is sent.
//
// Nothing here takes money. The server never charges by itself, and this
// records ops' ruling under whoever Access says is signed in
// (src/policy/no-show.ts, docs/decisions/0031-access-and-audit.md).

import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, type Charge, type NoShowCase } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { noShows } from "../content.ts";
import { Left } from "../lib/Left.tsx";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./no-shows.module.css";

type Choice = "charged" | "waived";

/** The charge's first line: the client, then what it was. */
function whoOf(charge: Charge): string {
  const copy = noShows.money.charges;
  const name = charge.person?.name ?? copy.unknown;
  if (charge.kind === "no_show") return copy.noShow(name);
  return charge.change === "moved" ? copy.moved(name) : copy.cancelled(name);
}

/** The line of evidence beneath it, in the board's own words. */
function evidenceOf(charge: Charge): string {
  const copy = noShows.money.charges;
  const was = charge.visit_started_at === null ? copy.undated : indiaClock(charge.visit_started_at);
  if (charge.kind !== "no_show") return copy.changed(indiaClock(charge.at), was);
  return charge.technician === null ? copy.unattended(was) : copy.attended(charge.technician, was);
}

function Charges({ charges }: { charges: readonly Charge[] }) {
  const copy = noShows.money.charges;
  if (charges.length === 0) return <p className={styles.empty}>{copy.empty}</p>;

  return (
    <ul className={styles.charges}>
      {charges.map((charge) => (
        <li className={styles.chargeRow} key={charge.id}>
          <div className={styles.chargeLine}>
            <span className={styles.who}>{whoOf(charge)}</span>
            {/* A no-show carries no amount: ops rule on the evidence, and P2-M5 applies the charge. */}
            {charge.amount === null ? (
              <span className={styles.unrecorded}>{copy.noAmount}</span>
            ) : (
              <span className={styles.chargeAmount}>{rupees(charge.amount)}</span>
            )}
          </div>
          <p className={styles.evidence}>{evidenceOf(charge)}</p>
        </li>
      ))}
    </ul>
  );
}

function Money() {
  const [loaded, retry] = useLoad(api.dayMoney);
  const copy = noShows.money;

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const day = loaded.value;
  return (
    <section className={styles.panel} aria-labelledby="day-money">
      <VisuallyHidden as="h2" id="day-money">
        {copy.title}
      </VisuallyHidden>
      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt className={styles.figureName}>{copy.figures.collected}</dt>
          <dd className={styles.amount}>{rupees(day.collected)}</dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.figureName}>
            {copy.figures.processing}
            {day.refunded > 0 && <span className={styles.aside}>{copy.refunded(rupees(day.refunded))}</span>}
          </dt>
          <dd className={styles.amount}>{rupees(day.refunds_processing)}</dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.figureName}>
            {copy.figures.charged}
            {/*
             * Nothing records what a no-show was charged, so the figure holds
             * what was kept and says what it leaves out, rather than pricing a
             * no-show the system never priced (ADR 0036, PR #89).
             */}
            {day.no_shows_charged > 0 && <span className={styles.aside}>{copy.uncharged(day.no_shows_charged)}</span>}
          </dt>
          <dd className={styles.amount}>{rupees(day.charged)}</dd>
        </div>
      </dl>
      <h3 className={styles.chargesTitle}>{copy.charges.title}</h3>
      <Charges charges={day.charges} />
    </section>
  );
}

const copy = noShows.queue;

/** Whole minutes from one instant to another. */
const minutesBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 60_000);

/** "5 h 8 m after the booked start", or before it, as board D3 writes a length. */
function offsetOf(minutesLate: number): string {
  if (minutesLate === 0) return copy.onTime;
  const span = Math.abs(minutesLate);
  const words = copy.span(Math.floor(span / 60), span % 60);
  return minutesLate > 0 ? copy.after(words) : copy.before(words);
}

/** An instant as the queue dates one: "Fri 18 Sep, 6:03 pm". */
const datedOf = (instant: string) => copy.dated(shortDate(indiaDate(instant)), indiaClock(instant));

function bookedOf(each: NoShowCase): string {
  if (each.window_start === null || each.window_end === null) return noShows.money.charges.undated;
  return copy.booked(
    shortDate(indiaDate(each.window_start)),
    indiaClock(each.window_start),
    indiaClock(each.window_end),
  );
}

function checkInOf(each: NoShowCase): string {
  const time = indiaClock(each.checked_in_at);
  return each.minutes_late === null ? time : copy.checkIn(time, offsetOf(each.minutes_late));
}

function messageOf(each: NoShowCase): string {
  if (each.message_state === "delivered" && each.message_delivered_at !== null) {
    return copy.message.delivered(datedOf(each.message_delivered_at));
  }
  if (each.message_state === "delivered") return copy.message.sent;
  return copy.message[each.message_state];
}

/**
 * How long he waited, from the check-in to the close, and not the wait the
 * rules asked for. A check-in that reached us well after the phone's time says
 * how long it had been with us too, since that is the part our clock vouches for.
 */
function waitedOf(each: NoShowCase): string {
  if (each.closed_at === null) return copy.notClosed;
  const closed = indiaClock(each.closed_at);
  const byPhone = minutesBetween(each.checked_in_at, each.closed_at);
  const withUs = minutesBetween(each.received_at, each.closed_at);
  return byPhone === withUs ? copy.waited(byPhone, closed) : copy.waitedBoth(byPhone, withUs, closed);
}

function Facts({ each }: { each: NoShowCase }) {
  const claimed = each.phone_checked_in_at;
  const rows: readonly (readonly [string, ReactNode])[] = [
    [copy.facts.booked, bookedOf(each)],
    [copy.facts.checkIn, checkInOf(each)],
    // The phone's own word, where the bounds would not take it (src/policy/phone-clock.ts).
    ...(claimed === null || claimed === each.checked_in_at ? [] : [[copy.facts.claimed, datedOf(claimed)] as const]),
    [copy.facts.received, datedOf(each.received_at)],
    [
      copy.facts.distance,
      // Never a number when none was measured: a missing distance is not 0 m,
      // and this fact helps decide whether to charge a client (ADR 0036).
      each.distance_m === null ? (
        <span className={styles.unmeasured}>{copy.unmeasured}</span>
      ) : (
        copy.distance(each.distance_m)
      ),
    ],
    [copy.facts.whatsapp, messageOf(each)],
    [copy.facts.waited, waitedOf(each)],
  ];

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

/** The case's first line: the client, a way to their page, or why there is none. */
function Client({ each }: { each: NoShowCase }) {
  if (each.person === null) return <span className={styles.visit}>{copy.erased}</span>;
  return (
    <OpsLink className={styles.client} to={`/clients/${each.person.id}/visits`}>
      {each.person.name}
    </OpsLink>
  );
}

/** Where a case is in its ruling: open, a charge asked about, sending, or refused by the API. */
type Ruling =
  | { readonly step: "open" }
  | { readonly step: "confirming" }
  | { readonly step: "sending" }
  | { readonly step: "failed"; readonly code: string };

/** The charge, asked about once more; it takes the keyboard as it opens, where the buttons stood. */
function ConfirmCharge({ each, onCharge, onBack }: { each: NoShowCase; onCharge: () => void; onBack: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const day = each.visit_date === null ? copy.noDay : shortDate(each.visit_date);
  return (
    <div className={styles.confirm} ref={panel} tabIndex={-1} role="group" aria-labelledby={`confirm-${each.id}`}>
      <p className={styles.confirmLine} id={`confirm-${each.id}`}>
        {copy.confirm(each.person?.name ?? copy.erased, day)}
      </p>
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.charge} onClick={onCharge}>
          {copy.confirmCharge}
        </Button>
        <Button variant="outline" size="small" className={styles.waive} onClick={onBack}>
          {copy.back}
        </Button>
      </div>
    </div>
  );
}

function Case({ each, now, onDecided }: { each: NoShowCase; now: Date; onDecided: () => void }) {
  const [ruling, setRuling] = useState<Ruling>({ step: "open" });
  const [reason, setReason] = useState("");
  const chargeButton = useRef<HTMLButtonElement>(null);

  const decide = async (choice: Choice) => {
    setRuling({ step: "sending" });
    const answer = await api.decideNoShow(each.id, choice, reason.trim());
    if (answer.ok) onDecided();
    else setRuling({ step: "failed", code: answer.code });
  };

  const sending = ruling.step === "sending";
  const noReason = reason.trim() === "";
  return (
    <>
      <div className={styles.caseHead}>
        <Client each={each} />
        <Left due={each.due} now={now} />
      </div>
      <p className={styles.caseSub}>
        {each.visit_date === null ? copy.undated : copy.visit(shortDate(each.visit_date))}
        {each.technician !== null && ` · ${copy.attended(each.technician)}`}
      </p>
      <Facts each={each} />
      <label className={styles.reasonLabel} htmlFor={`reason-${each.id}`}>
        {copy.reason.label}
      </label>
      <textarea
        id={`reason-${each.id}`}
        className={styles.reasonField}
        maxLength={300}
        placeholder={copy.reason.placeholder}
        aria-describedby={`reason-hint-${each.id}`}
        value={reason}
        disabled={sending || ruling.step === "confirming"}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <p className={styles.reasonHint} id={`reason-hint-${each.id}`}>
        {copy.reason.hint}
      </p>
      {ruling.step === "confirming" ? (
        <ConfirmCharge
          each={each}
          onCharge={() => void decide("charged")}
          onBack={() => {
            setRuling({ step: "open" });
            // Back to the button that asked, rather than to the top of the page.
            requestAnimationFrame(() => chargeButton.current?.focus());
          }}
        />
      ) : (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            ref={chargeButton}
            className={styles.charge}
            disabled={sending || noReason}
            onClick={() => {
              setRuling({ step: "confirming" });
            }}
          >
            {sending ? copy.deciding : copy.charge}
          </Button>
          <Button
            variant="outline"
            size="small"
            className={styles.waive}
            disabled={sending || noReason}
            onClick={() => void decide("waived")}
          >
            {copy.waive}
          </Button>
        </div>
      )}
      {ruling.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[ruling.code] ?? copy.errors.unknown}
        </p>
      )}
    </>
  );
}

function Queue() {
  const [loaded, retry] = useLoad(api.noShows);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const now = new Date();
  return (
    <DecisionQueue
      titleId="no-shows"
      title={copy.title}
      items={loaded.value.cases}
      rowKind="case"
      empty={copy.empty}
      note={copy.note}
    >
      {(each, ruled) => <Case each={each} now={now} onDecided={ruled} />}
    </DecisionQueue>
  );
}

export function NoShowsScreen() {
  return (
    <Shell section="/no-shows" title={noShows.title}>
      <div className={styles.column}>
        <Money />
        {/* The board's second card is a disputed charge; the queue stands where it does. */}
        <p className={styles.caption}>{noShows.money.noDispute}</p>
        <Queue />
      </div>
    </Shell>
  );
}
