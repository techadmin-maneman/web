// A client's bookings that FSM refused five times running, held with their slot and their payment
// (docs/decisions/0095-a-booking-fsm-refuses-is-held.md). They head the Visits tab, which the Tasks board's
// "Booking not in FSM" leads to, each with what ops may do: try FSM again now, stop the hourly tries before booking
// it in FSM by hand, link the visit they booked there, or refund it. No board draws them.
//
// What each action did is said beneath the booking, and a booking booked or given back keeps its lines with nothing
// left to press; the visits' tables below it are as the page read them.

import { Button } from "@maneman/ui/Button";
import { Field } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate, indiaClock, indiaDate, longDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useRef, useState, type RefObject } from "react";
import { api, type ClientVisit, type HeldBooking, type HeldBookingRefunded } from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./clients.module.css";

const copy = clients.visits.held;

/** Which form is open beneath the booking. */
type Open = "none" | "link" | "refund";

/** What the booking's actions last said, and whether it is still waiting. */
interface Said {
  readonly lines: readonly string[];
  readonly settled: boolean;
}

/** How it was paid for: in money, by a credit, or not at all. */
function paidOf(booking: HeldBooking): string {
  if (booking.paid > 0) return copy.paid(rupees(booking.paid));
  return booking.uses_credit ? copy.credit : copy.free;
}

/** The code it was booked with, and what that takes off once the price is known; null for none. */
function codeOf(booking: HeldBooking): string | null {
  if (booking.discount_code === null) return null;
  const { code, amount_off: off } = booking.discount_code;
  return copy.code(clients.visits.code.applied(code, off === null ? null : rupees(off)));
}

function CodeLine({ booking }: { booking: HeldBooking }) {
  const code = codeOf(booking);
  return code === null ? null : <p className={styles.heldLine}>{code}</p>;
}

/** Whether it is still tried by itself, has stopped being tried, or its time has passed. */
function triesOf(booking: HeldBooking, retrying: boolean, now: Date): string {
  if (Date.parse(booking.starts_at) <= now.getTime()) return copy.passed;
  if (retrying) return copy.retrying(`${longDate(booking.retries_end)}, ${indiaClock(booking.retries_end)}`);
  return copy.stopped;
}

/** What the refund did with the money, in ops' words. */
function moneyLine(booking: HeldBooking, money: HeldBookingRefunded["money"]): string {
  const amount = rupees(money.amount ?? booking.paid);
  const payment = money.payment_id ?? "";
  switch (money.kind) {
    case "refunded":
      return copy.money.refunded(amount, payment);
    case "refunded_before":
      return copy.money.refunded_before(payment);
    case "nothing_paid":
      return copy.money.nothing_paid;
    case "booked":
      return copy.money.booked;
    case "refund_refused":
      return copy.money.refund_refused(amount, payment);
    case "refund_unanswered":
      return copy.money.refund_unanswered(amount, payment);
  }
}

/** What an earlier try left in FSM, where there is something to say. */
function fsmLines(booking: HeldBooking, fsm: HeldBookingRefunded["fsm"]): string[] {
  if (fsm.kind === "cancelled" && fsm.work_order_id !== null) return [copy.fsm.cancelled(fsm.work_order_id)];
  if (fsm.kind === "not_cancelled" && fsm.work_order_id !== null) return [copy.fsm.not_cancelled(fsm.work_order_id)];
  if (fsm.kind === "unknown") return [copy.fsm.unknown(booking.id)];
  return [];
}

function LinkForm({
  booking,
  visits,
  busy,
  onLink,
  onCancel,
}: {
  booking: HeldBooking;
  visits: readonly ClientVisit[];
  busy: boolean;
  onLink: (visitId: string) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState(visits[0]?.id ?? "");
  if (visits.length === 0) {
    return (
      <div className={styles.heldForm}>
        <p className={styles.note}>{copy.linkNone}</p>
        <Button variant="outline" size="small" onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.heldForm}>
      <Field label={copy.linkLabel} hint={copy.linkHint}>
        {(control) => (
          <select
            {...control}
            className={styles.heldSelect}
            autoFocus
            value={chosen}
            disabled={busy}
            onChange={(event) => {
              setChosen(event.currentTarget.value);
            }}
          >
            {visits.map((visit) => (
              <option key={visit.id} value={visit.id}>
                {copy.visit(shortDate(visit.date), indiaClock(visit.starts_at))}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className={styles.heldActions}>
        <Button
          variant="outline"
          size="small"
          busy={busy}
          onClick={() => {
            onLink(chosen);
          }}
        >
          {busy ? copy.linking : copy.linkSave}
          <VisuallyHidden>{` · ${booking.service}`}</VisuallyHidden>
        </Button>
        <Button variant="outline" size="small" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

function RefundCheck({
  booking,
  busy,
  onRefund,
  onCancel,
}: {
  booking: HeldBooking;
  busy: boolean;
  onRefund: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.heldForm} role="group" aria-label={copy.refund}>
      <p className={styles.heldLine}>{copy.refundCheck(booking.paid > 0 ? rupees(booking.paid) : null)}</p>
      <div className={styles.heldActions}>
        <Button variant="outline" size="small" busy={busy} onClick={onRefund} autoFocus>
          {busy ? copy.refunding : copy.refundSave}
        </Button>
        <Button variant="outline" size="small" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

function Booking({ booking, visits, now }: { booking: HeldBooking; visits: readonly ClientVisit[]; now: Date }) {
  const [open, setOpen] = useState<Open>("none");
  const [said, setSaid] = useState<Said | null>(null);
  const [stopped, setStopped] = useState(false);
  /** Which of the row's two actions was pressed, for its own button to say it is working. */
  const [pressed, setPressed] = useState<"retry" | "stop">("retry");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const linkButton = useRef<HTMLButtonElement>(null);
  const refundButton = useRef<HTMLButtonElement>(null);
  const access = useAccess();
  const passed = Date.parse(booking.starts_at) <= now.getTime();
  const settled = said?.settled === true;
  const retrying = booking.retrying && !stopped;
  const mayRetry = !passed && access.mayCall("POST /api/held-bookings/{id}/retry");
  const mayStop = retrying && access.mayCall("POST /api/held-bookings/{id}/stop");
  const mayLink = !booking.moves_visit && access.mayCall("POST /api/held-bookings/{id}/link");
  const mayRefund = access.mayCall("POST /api/held-bookings/{id}/refund");
  const what = copy.what(
    clients.visits.types[booking.type],
    `${fullDate(indiaDate(booking.starts_at))}, ${indiaClock(booking.starts_at)}`,
  );

  /** Back to the button that opened a form, rather than to the top of the page. */
  const backTo = (button: RefObject<HTMLButtonElement | null>) => {
    setOpen("none");
    requestAnimationFrame(() => button.current?.focus());
  };

  const act = (work: () => Promise<Said | { readonly code: string }>) =>
    once(async () => {
      setFailed(null);
      const answer = await work();
      if ("code" in answer) {
        setFailed(copy.errors[answer.code] ?? copy.errors.unknown ?? "");
        return;
      }
      setOpen("none");
      setSaid(answer);
    });

  const retry = () => {
    setPressed("retry");
    return act(async () => {
      const answer = await api.retryHeldBooking(booking.id);
      if (!answer.ok) return { code: answer.code };
      const { outcome, refusal } = answer.body;
      if (outcome === "refused") return { lines: [copy.tried.refused(refusal ?? copy.noRefusal)], settled: false };
      return { lines: [copy.tried[outcome]], settled: outcome !== "to_link" };
    });
  };

  const stop = () => {
    setPressed("stop");
    return act(async () => {
      const answer = await api.stopHeldBooking(booking.id);
      if (!answer.ok) return { code: answer.code };
      setStopped(true);
      return { lines: [copy.stoppedNow], settled: false };
    });
  };

  const link = (visitId: string) =>
    act(async () => {
      const answer = await api.linkHeldBooking(booking.id, visitId);
      if (!answer.ok) return { code: answer.code };
      return { lines: [copy.linked, ...fsmLines(booking, answer.body.fsm)], settled: true };
    });

  const refund = () =>
    act(async () => {
      const answer = await api.refundHeldBooking(booking.id);
      if (!answer.ok) return { code: answer.code };
      const { money, fsm } = answer.body;
      return {
        lines: [moneyLine(booking, money), ...fsmLines(booking, fsm)],
        settled: money.kind !== "refund_refused" && money.kind !== "refund_unanswered",
      };
    });

  return (
    <li className={styles.heldItem}>
      <p className={styles.heldWhat}>{what}</p>
      <p className={styles.heldLine}>{paidOf(booking)}</p>
      <CodeLine booking={booking} />
      <p className={styles.heldLine}>{booking.refusal === null ? copy.noRefusal : copy.refusal(booking.refusal)}</p>
      {!settled && <p className={styles.heldLine}>{triesOf(booking, retrying, now)}</p>}
      {!settled && open === "none" && (
        <div className={styles.heldActions}>
          {mayRetry && (
            <Button
              variant="outline"
              size="small"
              busy={busy && pressed === "retry"}
              disabled={busy && pressed !== "retry"}
              onClick={() => void retry()}
            >
              {busy && pressed === "retry" ? copy.trying : copy.retry}
              <VisuallyHidden>{` · ${what}`}</VisuallyHidden>
            </Button>
          )}
          {mayStop && (
            <Button
              variant="outline"
              size="small"
              busy={busy && pressed === "stop"}
              disabled={busy && pressed !== "stop"}
              onClick={() => void stop()}
            >
              {busy && pressed === "stop" ? copy.stopping : copy.stop}
              <VisuallyHidden>{` · ${what}`}</VisuallyHidden>
            </Button>
          )}
          {mayLink && (
            <Button
              variant="outline"
              size="small"
              ref={linkButton}
              disabled={busy}
              onClick={() => {
                setOpen("link");
              }}
            >
              {copy.link}
              <VisuallyHidden>{` · ${what}`}</VisuallyHidden>
            </Button>
          )}
          {mayRefund && (
            <Button
              variant="outline"
              size="small"
              ref={refundButton}
              disabled={busy}
              onClick={() => {
                setOpen("refund");
              }}
            >
              {copy.refund}
              <VisuallyHidden>{` · ${what}`}</VisuallyHidden>
            </Button>
          )}
        </div>
      )}
      {open === "link" && (
        <LinkForm
          booking={booking}
          visits={visits.filter((visit) => visit.type === booking.type)}
          busy={busy}
          onLink={(visitId) => void link(visitId)}
          onCancel={() => {
            backTo(linkButton);
          }}
        />
      )}
      {open === "refund" && (
        <RefundCheck
          booking={booking}
          busy={busy}
          onRefund={() => void refund()}
          onCancel={() => {
            backTo(refundButton);
          }}
        />
      )}
      <div role="status">
        {said?.lines.map((line) => (
          <p className={styles.done} key={line}>
            {line}
          </p>
        ))}
      </div>
      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </li>
  );
}

export function HeldBookings({
  bookings,
  upcoming,
}: {
  bookings: readonly HeldBooking[];
  /** The client's visits to come, among which the one ops booked in FSM by hand is found. */
  upcoming: readonly ClientVisit[];
}) {
  if (bookings.length === 0) return null;
  const now = new Date();
  return (
    <section className={styles.held} aria-labelledby="held-bookings">
      <h3 className={styles.sectionTitle} id="held-bookings">
        {copy.title}
      </h3>
      <p className={styles.heldNote}>{copy.note}</p>
      <ul className={styles.heldList}>
        {bookings.map((booking) => (
          <Booking key={booking.id} booking={booking} visits={upcoming} now={now} />
        ))}
      </ul>
    </section>
  );
}
