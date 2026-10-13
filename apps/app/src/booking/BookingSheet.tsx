// Booking a visit in the app, while self-serve booking is on
// (docs/decisions/0045-self-serve-booking.md). A sheet rises: the date, the
// window, then paying through Razorpay Checkout. Paid, the sheet waits while
// Razorpay's webhook confirms and the visit is booked, polling the hold.
// Closed before Checkout was opened on it, the hold is let go; after, a payment
// may still land on its order, and the API lets it go once its grace ends.
// Moving a visit takes the same steps, with its own technician and
// at what the move costs.
//
// With more than one service open to them, a client picks theirs first, from
// every one ops offer (docs/decisions/0085-services-ops-can-edit.md). A client
// who has given no address is asked for it before the date, since no slot is
// held without one (ADR 0079); one whose address is in a pincode we do not come
// to is offered no day, and changes the address or joins the waitlist. The pay
// step of a new visit says what booking also agrees to, and its tap sends that
// on (ADR 0080).
//
// Opened with the visit the app offers next, the sheet starts its strip a week
// before the day offered and has that day and window chosen where they are
// free, for the client to take or change (ADR 0086). With the day offered full,
// the next open day is chosen. Later days are added to the strip on asking, up
// to the last a visit may be booked on.
//
// The steps, and the step each answer, tap or clock leads to, are flow.ts's; the
// hold's countdown and the wait for a paid one to be booked are hold-clocks.ts's.
// When the phone sees the countdown end it lets the hold go too, but not while
// Checkout is open: it waits for Checkout's answer.

import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { addDays } from "@maneman/web-kit/dates";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import {
  api,
  type Address,
  type BookableType,
  type BookingWindow,
  type MoveTerms,
  type OfferedService,
  type Profile,
  type Wanted,
} from "../api.ts";
import { booking } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import { drawsItsOwnClose, nextStep } from "./flow.ts";
import { hasLaterDays } from "./days.ts";
import { useDays } from "./use-days.ts";
import { usePay } from "./use-pay.ts";
import { AddressStep, NotServedStep } from "./steps/AddressStep.tsx";
import { ConfirmedStep, ExpiredStep, FailedStep, WaitStep } from "./steps/OutcomeSteps.tsx";
import { DateStep } from "./steps/DateStep.tsx";
import { LoadingStep, TITLE_ID } from "./steps/shared.tsx";
import { PayStep } from "./steps/PayStep.tsx";
import { ServiceStep, type Recommended } from "./steps/ServiceStep.tsx";
import { WindowStep } from "./steps/WindowStep.tsx";
import styles from "./booking.module.css";

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

interface Props {
  /** The kind booked when there is nothing to pick: a move's own, or the one open to the client. */
  type: BookableType;
  /** Every service open to the client, a kind at a time; with more than one, the client picks theirs first. */
  services?: readonly OfferedService[];
  /** The service the app offers among them, chosen when the sheet opens for the client to take or change. */
  tier?: string;
  /** The hair system the consultation recommended, marked among a first fit's. */
  recommended?: Recommended;
  /** The visit being moved, and what moving it costs. */
  moving?: MoveTerms;
  /** The strip's first day, where it should not start from the first day open. */
  from?: string;
  /** The day and window the visit is offered on (ADR 0086), chosen where they are free. */
  offer?: Offered;
  /** `changed`: money moved or a visit was booked, so Home is out of date. */
  onClose: (changed: boolean) => void;
}

export function BookingSheet({ type, services = [], tier, recommended, moving, from, offer, onClose }: Props) {
  const movingId = moving?.visit_id;
  const offeredDate = offer?.date;
  const offeredWindow = offer?.window;
  const firstDay = from ?? (offeredDate === undefined ? undefined : addDays(offeredDate, -OFFER_WEEK));
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, dispatch] = useReducer(nextStep, { kind: "loading" });
  // A new visit with more than one service open to it is picked first; anything else books the one there is.
  const picking = moving === undefined && services.length > 1;
  const [wanted, setWanted] = useState<Wanted | null>(() => (picking ? null : onlyOne(type, services, moving)));
  const [picked, setPicked] = useState<OfferedService | null>(
    () => services.find((service) => service.tier === tier) ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Whether reminders are on: null when the profile could not say, and the sheet asks. */
  const [reminders, setReminders] = useState<boolean | null>(null);
  const [remind, setRemind] = useState(false);
  // True once the sheet knows it asks for the address before the date, which adds a step to the boards' three.
  const [addressFirst, setAddressFirst] = useState(false);
  // The profile had no address when it was last read, so the address comes before the date.
  const addressMissing = useRef(false);
  // The address the profile had when it was last read.
  const savedAddress = useRef<Address | null>(null);
  /** The photograph purposes the client has never decided on, which booking a new visit also agrees to. */
  const days = useDays({ dispatch, movingId, offeredDate, offeredWindow, addressMissing });
  const { availability, date, chosenWindow, showDays } = days;

  const askForAddress = (refused: boolean) => {
    setAddressFirst(true);
    dispatch({ kind: "addressNeeded", refused });
  };

  /** The API offers nothing at the address saved, which the client changes, or they join the waitlist. */
  const showNotServed = () => {
    dispatch({ kind: "notServed", address: savedAddress.current });
  };

  /**
   * Reads the profile, and the days of the visit wanted once there is one, and goes to the first step still to take:
   * picking the visit, the address, or the date.
   */
  const load = async (visit: Wanted | null) => {
    dispatch({ kind: "asking" });
    const [answer, profile] = await Promise.all([
      visit === null ? null : api.availability(visit, movingId, firstDay),
      api.profile(),
    ]);
    setReminders(profile.ok ? remindersOn(profile.body) : null);
    savedAddress.current = profile.ok ? profile.body.address : null;
    if (answer !== null && !answer.ok) {
      if (answer.code === "not_served") showNotServed();
      else dispatch({ kind: "failed" });
      return;
    }
    addressMissing.current = profile.ok && profile.body.address === null;
    // Known now, so the step that picks the visit counts the address among the steps to come.
    if (addressMissing.current) setAddressFirst(true);
    if (answer === null) dispatch({ kind: "answered", picking: true, addressMissing: addressMissing.current });
    else showDays(answer.body);
  };

  // Read as the sheet opens, and again should what it opened on change; the step's own buttons read it again too.
  const loadNow = useEffectEvent(() => {
    void load(wanted);
  });
  useEffect(() => {
    loadNow();
  }, [movingId, firstDay, offeredDate, offeredWindow]);

  /** The client has picked their visit: its days, the profile already read. */
  const pick = async (service: OfferedService) => {
    const visit = { type: service.type, tier: service.tier };
    setWanted(visit);
    dispatch({ kind: "asking" });
    const answer = await api.availability(visit, movingId, firstDay);
    if (answer.ok) showDays(answer.body);
    else if (answer.code === "not_served") showNotServed();
    else dispatch({ kind: "failed" });
  };

  // Each step's heading takes the focus the last step's button took with it, as it does when "Later dates" goes with
  // the last of them.
  const daysShown = availability?.days.length;
  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>(`#${TITLE_ID}`) ?? null);
  }, [step.kind, daysShown]);

  const close = () => dialog.current?.close();

  const holdWindow = async () => {
    if (wanted === null || date === null || chosenWindow === null) return;
    setBusy(true);
    setProblem(null);
    const answer = await api.hold(wanted, date, chosenWindow, movingId);
    setBusy(false);
    if (answer.ok) dispatch({ kind: "held", hold: answer.body });
    else if (answer.code === "taken") {
      setProblem(booking.window.taken);
      await days.askAgainFrom(wanted, date);
    } else if (answer.code === "address_required") askForAddress(true);
    else if (answer.code === "not_served") showNotServed();
    else setProblem(booking.failedToStart);
  };

  /** The client ticked "Remind me": their yes to WhatsApp about their visits, recorded under the box's own line. */
  const switchOnReminders = async () => {
    const answer = await api.switchConsent("whatsapp_visits", true, "app_booking");
    if (answer.ok) setReminders(true);
  };

  const { payFor, letGo, changed, paying } = usePay(step, {
    dialog,
    dispatch,
    movingId,
    beforeStarting: async () => {
      if (remind && reminders !== true) await switchOnReminders();
    },
    setBusy,
    setProblem,
  });

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
      {!drawsItsOwnClose(step) && <SheetClose onClose={close}>{booking.close}</SheetClose>}
      <SheetPanel className={styles.sheet}>
        {step.kind === "loading" && <LoadingStep />}
        {step.kind === "broken" && <WaitStep text={booking.failedToStart} onClose={close} />}
        {step.kind === "service" && (
          <ServiceStep
            before={before}
            services={services}
            chosen={picked}
            recommended={recommended}
            onChoose={setPicked}
            onNext={() => {
              if (picked !== null) void pick(picked);
            }}
          />
        )}
        {step.kind === "address" && (
          <AddressStep refused={step.refused} before={before} onSaved={() => void load(wanted)} />
        )}
        {step.kind === "notServed" && <NotServedStep address={step.address} onSaved={() => void load(wanted)} />}
        {step.kind === "date" && availability !== null && (
          <DateStep
            before={before}
            days={availability.days}
            noticeHours={availability.change_notice_hours}
            offered={offeredDate ?? null}
            chosen={date}
            later={
              hasLaterDays(availability)
                ? {
                    busy: days.laterAsk === "busy",
                    failed: days.laterAsk === "failed",
                    onShow: () => void days.showLater(wanted),
                  }
                : null
            }
            onChoose={days.chooseDate}
            onNext={() => {
              dispatch({ kind: "dayTaken" });
            }}
          />
        )}
        {step.kind === "window" && day !== undefined && availability !== null && (
          <WindowStep
            before={before}
            day={day}
            noticeHours={availability.change_notice_hours}
            chosen={chosenWindow}
            busy={busy}
            problem={problem}
            onChoose={days.setChosenWindow}
            onNext={() => void holdWindow()}
          />
        )}
        {step.kind === "pay" && (
          <PayStep
            hold={step.hold}
            moving={moving}
            busy={busy}
            problem={problem}
            askToRemind={reminders !== true}
            remind={remind}
            onRemind={setRemind}
            onPay={() => void payFor(step.hold)}
            onHold={(hold) => {
              dispatch({ kind: "held", hold });
            }}
          />
        )}
        {step.kind === "failed" && <FailedStep hold={step.hold} busy={busy} onRetry={() => void payFor(step.hold)} />}
        {step.kind === "expired" && <ExpiredStep onPickAgain={() => void load(wanted)} />}
        {step.kind === "confirming" && <WaitStep text={step.paidIn === true ? booking.paidIn : booking.confirming} />}
        {step.kind === "confirmed" && (
          <ConfirmedStep hold={step.hold} moved={moving !== undefined} reminded={reminders === true} onDone={close} />
        )}
        {step.kind === "slow" && (
          <WaitStep text={step.paid || reminders === true ? booking.slow : booking.slowQuiet} onClose={close} />
        )}
        {step.kind === "refunded" && <WaitStep text={booking.refunded} onClose={close} />}
      </SheetPanel>
    </Sheet>
  );
}
