// Booking a visit in the app (boards C2 to C6), while self-serve booking is on
// (docs/decisions/0045-self-serve-booking.md). A sheet rises: the date, the
// window, then paying through Razorpay Checkout. Paid, the sheet waits while
// Razorpay's webhook confirms and the visit is booked in FSM, polling the hold.
// Closed before Checkout was opened on it, the hold is let go; after, a payment
// may still land on its order, and the API lets it go once its grace ends.
// Moving a visit (board C7) takes the same steps, with its own technician and
// at what the move costs.
//
// With more than one service open to them, a client picks theirs first, from
// every one ops offer (docs/decisions/0085-services-ops-can-edit.md). A client
// who has given no address is asked for it before the date, since no slot is
// held without one (ADR 0079). The pay step of a new visit says what booking
// also agrees to, and its tap sends that on (ADR 0080).
//
// Opened with the visit the app offers next, the sheet starts its strip a week
// before the day offered and has that day and window chosen where they are
// free, for the client to take or change (ADR 0086). With the day offered full,
// the next open day is chosen. Later days are added to the strip on asking, up
// to the last a visit may be booked on.
//
// The hold's ten minutes are counted on the API's clock, not the phone's
// (lib/clock.ts). When the phone sees them run out it lets the hold go too, but
// not while Checkout is open: it waits for Checkout's answer.

import { Sheet } from "@maneman/ui/Sheet";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type Availability,
  type BookableType,
  type Booking,
  type BookingConsent,
  type BookingWindow,
  type Hold,
  type MoveTerms,
  type OfferedService,
  type Profile,
  type Wanted,
} from "../api.ts";
import { booking } from "../content.ts";
import { focusIfLost } from "../lib/arrival.ts";
import { apiNow } from "../lib/clock.ts";
import { loadCheckout, pay, type Paid, type PayMethod } from "./checkout.ts";
import { undecidedOf } from "./consents.ts";
import { dayAfter, firstOpenFrom, hasLaterDays, openWindow, withDays } from "./days.ts";
import {
  AddressStep,
  ConfirmedStep,
  DateStep,
  ExpiredStep,
  FailedStep,
  LoadingStep,
  paysNothing,
  PayStep,
  ServiceStep,
  TITLE_ID,
  WaitStep,
  WindowStep,
} from "./steps.tsx";
import styles from "./booking.module.css";

type Step =
  | { readonly kind: "loading" }
  /** No address yet (ADR 0079). `refused`: the API refused a hold for want of one. */
  | { readonly kind: "address"; readonly refused: boolean }
  /** More than one service is open to the client, and they pick one (ADR 0085). */
  | { readonly kind: "service" }
  | { readonly kind: "date" }
  | { readonly kind: "window" }
  | { readonly kind: "pay"; readonly hold: Hold }
  | { readonly kind: "failed"; readonly hold: Hold }
  | { readonly kind: "expired" }
  /** `paidIn`: the phone saw the hold's time end, and found the payment already in. */
  | { readonly kind: "confirming"; readonly hold: Hold; readonly paidIn?: boolean }
  | { readonly kind: "confirmed"; readonly hold: Hold }
  | { readonly kind: "slow" }
  | { readonly kind: "refunded" }
  | { readonly kind: "broken" };

/** How often, and for how long, the sheet asks whether a paid hold is booked. */
const POLL_MS = 2_000;
const POLL_FOR_MS = 60_000;

/** Whether the hold's countdown has run out, by the API's clock. */
const hasRunOut = (hold: Hold) => apiNow() >= Date.parse(hold.expires_at);

/** Whether the client has switched on WhatsApp about their visits, the purpose the day-before reminder is sent under. */
const remindersOn = (profile: Profile) =>
  profile.consents.some((consent) => consent.purpose === "whatsapp_visits" && consent.granted);

/**
 * What a sheet with nothing to pick books: the one service open to the client, or else the kind's standard one;
 * for a move, its visit's own, which the API knows.
 */
function onlyOne(type: BookableType, services: readonly OfferedService[], moving: MoveTerms | undefined): Wanted {
  const [only] = services;
  return moving === undefined && only !== undefined ? { type: only.type, tier: only.tier } : { type };
}

/** The day and window a visit is offered on, which the sheet opens with chosen. */
export interface Offered {
  readonly date: string;
  readonly window: BookingWindow | null;
}

/** How many days before the day offered the strip starts, so a week either side of it is in view. */
const OFFER_WEEK = 7;

/** India's day `days` before `date`, both YYYY-MM-DD. */
const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** Asking for the days after those shown: not yet, under way, or failed. */
type LaterAsk = "idle" | "busy" | "failed";

export function BookingSheet({
  type,
  services = [],
  tier,
  moving,
  from,
  offer,
  onClose,
}: {
  /** The kind booked when there is nothing to pick: a move's own, or the one open to the client. */
  type: BookableType;
  /** Every service open to the client, a kind at a time; with more than one, the client picks theirs first. */
  services?: readonly OfferedService[];
  /** The service the app offers among them, chosen when the sheet opens for the client to take or change. */
  tier?: string;
  /** The visit being moved, and what moving it costs. */
  moving?: MoveTerms;
  /** The strip's first day, where it should not start from the first day open. */
  from?: string;
  /** The day and window the visit is offered on (ADR 0086), chosen where they are free. */
  offer?: Offered;
  /** `changed`: money moved or a visit was booked, so Home is out of date. */
  onClose: (changed: boolean) => void;
}) {
  const movingId = moving?.visit_id;
  const offeredDate = offer?.date;
  const offeredWindow = offer?.window;
  const firstDay = from ?? (offeredDate === undefined ? undefined : daysBefore(offeredDate, OFFER_WEEK));
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>({ kind: "loading" });
  // A new visit with more than one service open to it is picked first; anything else books the one there is.
  const picking = moving === undefined && services.length > 1;
  const [wanted, setWanted] = useState<Wanted | null>(() => (picking ? null : onlyOne(type, services, moving)));
  const [picked, setPicked] = useState<OfferedService | null>(
    () => services.find((service) => service.tier === tier) ?? null,
  );
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [laterAsk, setLaterAsk] = useState<LaterAsk>("idle");
  const [date, setDate] = useState<string | null>(null);
  const [chosenWindow, setChosenWindow] = useState<BookingWindow | null>(null);
  const [method, setMethod] = useState<PayMethod>("upi");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Whether reminders are on: null when the profile could not say, and the sheet asks. */
  const [reminders, setReminders] = useState<boolean | null>(null);
  const [remind, setRemind] = useState(false);
  // True once the sheet knows it asks for the address before the date, which adds a step to the boards' three.
  const [addressFirst, setAddressFirst] = useState(false);
  // The profile had no address when it was last read, so the address comes before the date.
  const addressMissing = useRef(false);
  /** The photograph purposes the client has never decided on, which booking a new visit also agrees to. */
  const [undecided, setUndecided] = useState<readonly BookingConsent[]>([]);
  // True once the client has paid, or booked without paying, so Home is fetched again when the sheet closes.
  const changed = useRef(false);
  // True while Razorpay Checkout is open, and this sheet has stepped out of its way.
  const paying = useRef(false);
  // True from the tap until Checkout has answered. `busy` disables the buttons, but only on
  // the next render, and a tap in that gap would pay for the hold a second time (ADR 0057).
  const starting = useRef(false);
  // The hold that has a Razorpay order. The app never lets that one go: a payment may still land on it.
  const ordered = useRef<string | null>(null);

  const askForAddress = (refused: boolean) => {
    setAddressFirst(true);
    setStep({ kind: "address", refused });
  };

  /**
   * The days of the visit wanted, and the step after them: the address if there is none yet, else the date. The first
   * open day on or after the day offered is chosen, and the window offered where it is open that day.
   */
  const showDays = (days: Availability) => {
    setAvailability(days);
    setLaterAsk("idle");
    const chosen = offeredDate === undefined ? null : firstOpenFrom(days.days, offeredDate);
    setDate(chosen);
    setChosenWindow(
      openWindow(
        days.days.find((each) => each.date === chosen),
        offeredWindow,
      ),
    );
    if (addressMissing.current) askForAddress(false);
    else setStep({ kind: "date" });
  };

  /**
   * Reads the profile, and the days of the visit wanted once there is one, and goes to the first step still to take:
   * picking the visit, the address, or the date.
   */
  const load = useCallback(
    async (visit: Wanted | null) => {
      setStep({ kind: "loading" });
      const [answer, profile] = await Promise.all([
        visit === null ? null : api.availability(visit, movingId, firstDay),
        api.profile(),
      ]);
      if (answer !== null && !answer.ok) {
        setStep({ kind: "broken" });
        return;
      }
      setReminders(profile.ok ? remindersOn(profile.body) : null);
      setUndecided(profile.ok ? undecidedOf(profile.body) : []);
      addressMissing.current = profile.ok && profile.body.address === null;
      // Known now, so the step that picks the visit counts the address among the steps to come.
      if (addressMissing.current) setAddressFirst(true);
      if (answer === null) setStep({ kind: "service" });
      else showDays(answer.body);
    },
    [movingId, firstDay, offeredDate, offeredWindow],
  );

  useEffect(() => {
    void load(wanted);
  }, [load]);

  /** The client has picked their visit: its days, the profile already read. */
  const pick = async (service: OfferedService) => {
    const visit = { type: service.type, tier: service.tier };
    setWanted(visit);
    setStep({ kind: "loading" });
    const answer = await api.availability(visit, movingId, firstDay);
    if (answer.ok) showDays(answer.body);
    else setStep({ kind: "broken" });
  };

  /** The days after the last shown, added to the strip. */
  const showLater = async () => {
    const lastShown = availability?.days.at(-1)?.date;
    if (wanted === null || lastShown === undefined) return;
    setLaterAsk("busy");
    const answer = await api.availability(wanted, movingId, dayAfter(lastShown));
    if (!answer.ok) {
      setLaterAsk("failed");
      return;
    }
    setLaterAsk("idle");
    setAvailability((now) =>
      now === null ? answer.body : { ...answer.body, days: withDays(now.days, answer.body.days) },
    );
  };

  // Each step's heading takes the focus the last step's button took with it, as it does when "Later dates" goes with
  // the last of them.
  const daysShown = availability?.days.length;
  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>(`#${TITLE_ID}`) ?? null);
  }, [step.kind, daysShown]);

  /** Lets an unpaid hold go for someone else, unless it has an order, which the API lets go once its grace ends. */
  const letGo = (hold: Hold) => {
    if (ordered.current !== hold.id) void api.releaseHold(hold.id);
  };

  // A function, so TypeScript does not take the ref as unchanged across an await.
  const isPaying = () => starting.current;

  /**
   * The hold's time has run out. A payment Razorpay took in time keeps the hold, so the API is asked first. While the
   * client is paying, this waits: payFor runs it again with Checkout's answer.
   */
  const lapse = async (hold: Hold) => {
    if (isPaying()) return;
    const now = await api.holdById(hold.id);
    if (now.ok && now.body.paid) {
      changed.current = true;
      setStep({ kind: "confirming", hold: now.body, paidIn: true });
      return;
    }
    // The client tapped Pay while the API was answering.
    if (isPaying()) return;
    setStep({ kind: "expired" });
    letGo(hold);
  };

  const holdOf = step.kind === "pay" || step.kind === "failed" ? step.hold : null;
  useEffect(() => {
    if (holdOf === null) return;
    const timer = window.setTimeout(() => void lapse(holdOf), Math.max(0, Date.parse(holdOf.expires_at) - apiNow()));
    return () => {
      window.clearTimeout(timer);
    };
  }, [holdOf]);

  // Checkout's script loads as soon as there is something to pay, so paying starts at once. A script
  // that fails here is tried again at the tap, which is where the client is told.
  const toPay = step.kind === "pay" && !paysNothing(step.hold);
  useEffect(() => {
    if (toPay) loadCheckout().catch(() => undefined);
  }, [toPay]);

  // Paid, or free: asks every two seconds, for a minute, whether the visit is booked.
  const confirming = step.kind === "confirming" ? step.hold : null;
  useEffect(() => {
    if (confirming === null) return;
    const started = Date.now();
    let current = true;
    const ask = async () => {
      const answer = await api.holdById(confirming.id);
      if (!current) return;
      if (answer.ok && answer.body.state === "booked") setStep({ kind: "confirmed", hold: answer.body });
      else if (answer.ok && answer.body.state === "released") setStep({ kind: "refunded" });
      else if (Date.now() - started > POLL_FOR_MS) setStep({ kind: "slow" });
      else timer = window.setTimeout(() => void ask(), POLL_MS);
    };
    let timer = window.setTimeout(() => void ask(), POLL_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [confirming]);

  const close = () => dialog.current?.close();

  const holdWindow = async () => {
    if (wanted === null || date === null || chosenWindow === null) return;
    setBusy(true);
    setProblem(null);
    const answer = await api.hold(wanted, date, chosenWindow, movingId);
    setBusy(false);
    if (answer.ok) setStep({ kind: "pay", hold: answer.body });
    else if (answer.code === "taken") {
      setProblem(booking.window.taken);
      // From the day chosen, which may be among the later days.
      const fresh = await api.availability(wanted, movingId, date);
      if (fresh.ok) {
        setAvailability((now) =>
          now === null ? fresh.body : { ...fresh.body, days: withDays(now.days, fresh.body.days) },
        );
      }
      setChosenWindow(null);
    } else if (answer.code === "address_required") askForAddress(true);
    else setProblem(booking.failedToStart);
  };

  /**
   * A sheet opened with showModal() sits in the browser's top layer and makes
   * the rest of the page inert, so Checkout's own window would be drawn under
   * it and take no taps (proven on staging, 23 September 2026). The sheet
   * therefore closes while Checkout is up, and rises again with the answer;
   * `paying` keeps that close from letting the hold go. Checkout's script is
   * waited for first, with the sheet still up and busy, so a script that
   * never comes ends on the sheet's own payment-failed step.
   */
  const throughCheckout = async (
    checkout: NonNullable<Booking["checkout"]>,
    how: PayMethod,
    payBy: string,
  ): Promise<Paid> => {
    const ready = await loadCheckout().then(
      () => true,
      () => false,
    );
    if (!ready) return "failed";
    paying.current = true;
    dialog.current?.close();
    const outcome = await pay(checkout, how, payBy).catch(() => "failed" as const);
    dialog.current?.showModal();
    paying.current = false;
    return outcome;
  };

  /** The client ticked "Remind me": their yes to WhatsApp about their visits, on that purpose's own notice. */
  const switchOnReminders = async () => {
    const answer = await api.switchConsent("whatsapp_visits", true, "app_booking");
    if (answer.ok) setReminders(true);
  };

  /** The visit credit this hold counted on went on another booking: the client sees the price before Checkout opens. */
  const showPriceInstead = async (holdId: string) => {
    const fresh = await api.holdById(holdId);
    setBusy(false);
    if (!fresh.ok) {
      setProblem(booking.failedToStart);
      return;
    }
    setStep({ kind: "pay", hold: fresh.body });
    setProblem(booking.creditGone);
  };

  /** The booking started, and Checkout's answer; null when the API would not start it, or the price must show first. */
  const startPaying = async (hold: Hold, how: PayMethod): Promise<Paid | null> => {
    if (remind && reminders !== true) await switchOnReminders();
    const started =
      movingId === undefined ? await api.book(hold.id, undecided) : await api.startMove(movingId, hold.id);
    if (!started.ok) {
      if (started.code === "hold_expired") setStep({ kind: "expired" });
      else setProblem(booking.failedToStart);
      return null;
    }
    const checkout = started.body.checkout;
    if (checkout === null) return "paid";
    ordered.current = hold.id;
    if (paysNothing(hold)) {
      await showPriceInstead(hold.id);
      return null;
    }
    return throughCheckout(checkout, how, hold.pay_by);
  };

  const payFor = async (hold: Hold, how: PayMethod) => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setProblem(null);
    const outcome = await startPaying(hold, how).finally(() => {
      starting.current = false;
      setBusy(false);
    });
    if (outcome === "paid") {
      changed.current = true;
      setStep({ kind: "confirming", hold });
      return;
    }
    // The hold's time may have run out while the client was paying, and its lapse waited for this answer.
    if (hasRunOut(hold)) void lapse(hold);
    else if (outcome === "failed") setStep({ kind: "failed", hold });
  };

  const day = availability?.days.find((each) => each.date === date);
  // The steps before the date, each of which puts the date and the window one step later.
  const before = (picking ? 1 : 0) + (addressFirst ? 1 : 0);
  return (
    <Sheet
      ref={dialog}
      className={styles.dialog}
      labelledBy={TITLE_ID}
      onClose={() => {
        // Stepping out of Checkout's way is not the client closing the sheet (Sheet ignores that close's
        // event if it arrives after the sheet has risen again).
        if (paying.current) return;
        // Closed before it was paid for, the hold is let go for someone else.
        if (step.kind === "pay" || step.kind === "failed") letGo(step.hold);
        onClose(changed.current);
      }}
    >
      <button className={styles.close} type="button" onClick={close}>
        {booking.close}
      </button>
      <div className={styles.sheet}>
        {step.kind === "loading" && <LoadingStep />}
        {step.kind === "broken" && <WaitStep text={booking.failedToStart} onClose={close} />}
        {step.kind === "service" && (
          <ServiceStep
            before={before}
            services={services}
            chosen={picked}
            onChoose={setPicked}
            onNext={() => {
              if (picked !== null) void pick(picked);
            }}
          />
        )}
        {step.kind === "address" && (
          <AddressStep refused={step.refused} before={before} onSaved={() => void load(wanted)} />
        )}
        {step.kind === "date" && availability !== null && (
          <DateStep
            before={before}
            days={availability.days}
            offered={offeredDate ?? null}
            chosen={date}
            later={
              hasLaterDays(availability)
                ? { busy: laterAsk === "busy", failed: laterAsk === "failed", onShow: () => void showLater() }
                : null
            }
            onChoose={(chosen) => {
              setDate(chosen);
              // The window offered stays chosen on another day only where it is open there too.
              setChosenWindow(
                openWindow(
                  availability.days.find((each) => each.date === chosen),
                  offeredWindow,
                ),
              );
            }}
            onNext={() => {
              setStep({ kind: "window" });
            }}
          />
        )}
        {step.kind === "window" && day !== undefined && availability !== null && (
          <WindowStep
            before={before}
            day={day}
            regular={availability.regular}
            chosen={chosenWindow}
            busy={busy}
            problem={problem}
            onChoose={setChosenWindow}
            onNext={() => void holdWindow()}
          />
        )}
        {step.kind === "pay" && (
          <PayStep
            hold={step.hold}
            moving={moving}
            method={method}
            busy={busy}
            problem={problem}
            askToRemind={reminders !== true}
            consents={movingId === undefined ? undecided : []}
            remind={remind}
            onRemind={setRemind}
            onMethod={setMethod}
            onPay={() => void payFor(step.hold, method)}
            onHold={(hold) => {
              setStep({ kind: "pay", hold });
            }}
          />
        )}
        {step.kind === "failed" && (
          <FailedStep
            hold={step.hold}
            busy={busy}
            onRetry={() => void payFor(step.hold, method)}
            onAnother={() => {
              const other = method === "upi" ? "card" : "upi";
              setMethod(other);
              void payFor(step.hold, other);
            }}
          />
        )}
        {step.kind === "expired" && <ExpiredStep onPickAgain={() => void load(wanted)} />}
        {step.kind === "confirming" && <WaitStep text={step.paidIn === true ? booking.paidIn : booking.confirming} />}
        {step.kind === "confirmed" && (
          <ConfirmedStep hold={step.hold} moved={moving !== undefined} reminded={reminders === true} onDone={close} />
        )}
        {step.kind === "slow" && <WaitStep text={booking.slow} onClose={close} />}
        {step.kind === "refunded" && <WaitStep text={booking.refunded} onClose={close} />}
      </div>
    </Sheet>
  );
}
