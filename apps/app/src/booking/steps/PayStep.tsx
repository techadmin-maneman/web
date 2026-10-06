// Paying, with what the hold costs, what changing it later costs, and what the booking agrees to.

import { Button } from "@maneman/ui/Button";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import type { BookingConsent, Hold, MoveTerms } from "../../api.ts";
import { booking, change, WINDOW_HOURS } from "../../content.ts";
import { apiNow } from "../../lib/clock.ts";
import { priceFigures } from "../../lib/money.ts";
import { CodeBox } from "../CodeBox.tsx";
import { consentLines } from "../consents.ts";
import { atStake, insideNotice, type AtStake } from "../late-change.ts";
import styles from "../booking.module.css";
import { firstNameOf } from "../../../../../src/lib/names.ts";
import { minutesAndSeconds, useHoldLeft, paysNothing, Heading, LastMinute, LateFee } from "./shared.tsx";

/** What the pay step names: the service booked, or, for a move, the visit moved or its late fee. */
function itemName(hold: Hold, moving: MoveTerms | undefined): string {
  const what = hold.service.name;
  if (moving?.cost === "free") return change.moveItem(what);
  if (moving?.cost === "late_fee") return change.lateFeeItem(what);
  return what;
}

/** What the pay step's button says: what is paid, or, with nothing to pay, what is confirmed. */
function payLabel(hold: Hold, moving: MoveTerms | undefined): string {
  if (!paysNothing(hold)) return booking.pay.pay(rupees(hold.price.amount));
  return moving === undefined ? booking.pay.confirm : change.confirmMove;
}

/** The pay step's figure: nothing for a visit a credit covers, "Free" for one that costs nothing, else its price. */
function amountLine(hold: Hold, covered: boolean, free: boolean): string {
  if (covered) return booking.pay.credit.zero;
  return free ? booking.pay.free : rupees(hold.price.amount);
}

/** What a visit moved in place keeps: its payment or its credit. Nothing to say for one that held neither. */
function carriedOver(moving: MoveTerms): string | null {
  if (moving.credit !== null) return change.move.creditCarriesOver;
  return moving.paid > 0 ? change.move.carriesOver(rupees(moving.paid)) : null;
}

/** What a change inside the notice takes, where it takes anything. */
type Charged = Exclude<AtStake, { readonly kind: "nothing" }>;

/** "This visit is less than 24 hours away: moving or cancelling it costs Rs. 4,720 (Rs. 4,000 + Rs. 720 GST)." */
function InsideNotice({ stake, hours }: { stake: Charged; hours: number }) {
  const copy = booking.pay.insideNotice;
  if (stake.kind === "credit") return copy.credit(hours);
  if (stake.kind === "payment") return copy.payment(hours, rupees(stake.paid));
  const { amount, split } = priceFigures(stake.fee);
  return (
    <>
      {copy.lateFee(hours, amount)}
      {split !== null && <span className={styles.inclusive}>{booking.lateFee.split(split)}</span>}.
    </>
  );
}

/** "Free to move or cancel until 9 am, Fri 2 Oct.", and what a change costs after that. */
function FreeUntil({ hold, stake }: { hold: Hold; stake: Charged }) {
  const copy = booking.pay;
  const when = copy.freeUntil(`${indiaClock(hold.free_until)}, ${shortDate(indiaDate(hold.free_until))}`);
  if (stake.kind === "late_fee") {
    return (
      <>
        {`${when} `}
        <LateFee fee={stake.fee} noticeHours={hold.change_notice_hours} />
      </>
    );
  }
  // A credit's own note, beneath the button, says what a late cancel costs.
  if (stake.kind === "credit") return when;
  return `${when}${copy.afterThat}`;
}

/**
 * What changing the visit later costs, as the booking is sold: free at any time; free until a time, and its cost
 * after; or, for a visit already inside the notice, what a change costs from now.
 */
function LaterChanges({ hold, stake, late }: { hold: Hold; stake: AtStake; late: boolean }) {
  if (stake.kind === "nothing") return booking.pay.freeAnyTime;
  if (late) return <InsideNotice stake={stake} hours={hold.change_notice_hours} />;
  return <FreeUntil hold={hold} stake={stake} />;
}

/**
 * Beneath the pay step's lines: what a visit moved in place keeps, then what changing it later costs. `late`: the
 * visit is already inside its notice.
 */
function ChangeTerms(props: { hold: Hold; moving: MoveTerms | undefined; stake: AtStake; late: boolean }) {
  const line = `${styles.line ?? ""} ${styles.soft ?? ""}`;
  const kept = props.moving === undefined ? null : carriedOver(props.moving);
  return (
    <>
      {kept !== null && <p className={line}>{kept}</p>}
      <p className={line}>
        <LaterChanges hold={props.hold} stake={props.stake} late={props.late} />
      </p>
    </>
  );
}

/**
 * What booking also agrees to, one tap away beneath Pay: the notice the consent is recorded on, word for word.
 * Nothing when the client has decided both purposes.
 */
function AgreedByBooking({ consents }: { consents: readonly BookingConsent[] }) {
  const lines = consentLines(consents);
  if (lines.length === 0) return null;
  return (
    <details className={styles.consents}>
      <summary className={styles.consentsOpen}>{booking.pay.consents.open}</summary>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </details>
  );
}

/** The pay step, and the credit step's first fit: the held visit, what it costs, and Pay. */
export function PayStep(props: {
  hold: Hold;
  moving?: MoveTerms | undefined;
  busy: boolean;
  problem: string | null;
  /** Whether to ask to remind the client the day before: not when they have already switched it on. */
  askToRemind: boolean;
  /** The photograph purposes booking also agrees to. */
  consents: readonly BookingConsent[];
  remind: boolean;
  onRemind: (remind: boolean) => void;
  onPay: () => void;
  /** The hold priced again, once a discount code is applied or removed. */
  onHold: (hold: Hold) => void;
}) {
  const { hold, moving } = props;
  const copy = booking.pay;
  const left = useHoldLeft(hold);
  const technician = firstNameOf(hold.technician.name);
  const covered = hold.credit !== null;
  const free = paysNothing(hold);
  // A move in place keeps the visit as it was booked: only its new time, and what the move costs, are shown.
  const inPlace = moving !== undefined && moving.cost !== "charged";
  const stake = atStake(hold, inPlace ? moving : undefined);
  // Read on every tick of the hold's count, so a visit that passes into its notice while the client decides says so.
  const late = insideNotice(hold, apiNow());
  const isFirstFit = hold.type === "first_fit" && !inPlace;
  // A code is for a visit sold, never a move, nor one a credit pays for, nor a consultation, which costs nothing.
  const takesACode = moving === undefined && !covered && hold.type !== "consultation";
  const listPrice = hold.discount?.list_price ?? null;
  const { split } = priceFigures(hold.price);
  // A code being applied or taken off may change the price: Pay waits for it, so the order is for the price shown.
  const [codeSending, setCodeSending] = useState(false);
  return (
    <>
      <Heading title={free ? copy.titleFree : copy.title} aside={copy.held(minutesAndSeconds(left))} />
      <LastMinute left={left} />
      <div className={styles.summary}>
        <div className={styles.item}>
          <div>
            <p className={styles.itemName}>{itemName(hold, moving)}</p>
            <p className={styles.itemWhen}>{`${shortDate(hold.date)}, ${WINDOW_HOURS[hold.window]}`}</p>
            {/* The credit step draws "Two slots · 3 hours": the length is now the service's own (ADR 0085). */}
            {isFirstFit && <p className={styles.itemWhen}>{booking.length(hold.service.minutes)}</p>}
          </div>
          <div className={styles.money}>
            {covered && <p className={styles.was}>{rupees(hold.price.amount)}</p>}
            {listPrice !== null && <p className={styles.was}>{rupees(listPrice.amount)}</p>}
            <p className={styles.amount}>{amountLine(hold, covered, free)}</p>
            {!free && split !== null && <p className={styles.incl}>{split}</p>}
          </div>
        </div>
        {hold.credit !== null && (
          <p className={styles.creditLine}>
            <span>{copy.credit.used}</span>
            <span>{copy.credit.remaining(hold.credit.remaining)}</span>
          </p>
        )}
        {isFirstFit && <p className={styles.line}>{copy.guarantee}</p>}
        <ChangeTerms hold={hold} moving={inPlace ? moving : undefined} stake={stake} late={late} />
      </div>
      {takesACode && <CodeBox hold={hold} busy={props.busy} onHold={props.onHold} onSending={setCodeSending} />}
      {props.askToRemind && (
        <label className={styles.remind}>
          <input
            type="checkbox"
            checked={props.remind}
            onChange={(event) => {
              props.onRemind(event.target.checked);
            }}
          />
          <span>{copy.remind}</span>
        </label>
      )}
      {props.problem !== null && (
        <p className={styles.problem} role="alert">
          {props.problem}
        </p>
      )}
      <Button
        variant="primary"
        size="action"
        className={styles.primary}
        disabled={props.busy || codeSending || left === 0}
        busy={props.busy}
        onClick={props.onPay}
      >
        {payLabel(hold, moving)}
      </Button>
      {!free && <p className={styles.moneyNote}>{copy.neverHandlesMoney(technician)}</p>}
      {stake.kind === "credit" && !late && (
        <p className={styles.creditNote}>{copy.credit.note(hold.change_notice_hours)}</p>
      )}
      <AgreedByBooking consents={props.consents} />
    </>
  );
}
