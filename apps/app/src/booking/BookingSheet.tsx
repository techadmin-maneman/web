// Booking or moving a visit in the app (docs/decisions/0045-self-serve-booking.md): the service, the address where
// none is saved, the date, the start, then paying through Razorpay Checkout. The steps are ./flow.ts's, the hold's
// clocks ./hold-clocks.ts's, and the day it opens on docs/decisions/0086-the-next-visit-is-offered.md's.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { addDays } from "@maneman/web-kit/dates";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  api,
  type BookableType,
  type BookingWindow,
  type Hold,
  type MoveTerms,
  type OfferedService,
  type Wanted,
} from "../api.ts";
import { booking } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import { drawsItsOwnClose, nextStep, type Step } from "./flow.ts";
import { hasLaterDays } from "./days.ts";
import type { Days } from "./useDays.ts";
import { useSheetData } from "./useSheetData.ts";
import { usePay } from "./usePay.ts";
import { AddressStep, NotServedStep } from "./steps/AddressStep.tsx";
import { ConfirmedStep, ExpiredStep, FailedStep, WaitStep } from "./steps/OutcomeSteps.tsx";
import { DateStep } from "./steps/DateStep.tsx";
import { LoadingStep, TITLE_ID } from "./steps/shared.tsx";
import { PayStep } from "./steps/PayStep.tsx";
import { ServiceStep, type Recommended } from "./steps/ServiceStep.tsx";
import { TimeStep } from "./steps/TimeStep.tsx";
import styles from "./booking.module.css";

/**
 * What a sheet with nothing to pick books: the one service open to the client, or else the kind's standard one;
 * for a move, its visit's own, which the API knows.
 */
function onlyOne(type: BookableType, services: readonly OfferedService[], moving: MoveTerms | undefined): Wanted {
  const [only] = services;
  return moving === undefined && only !== undefined ? { type: only.type, tier: only.tier } : { type };
}

/** The day and window a visit is offered on: the sheet opens on its first open start in that window. */
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
  /** The day and window the visit is offered on, chosen where they are free. */
  offer?: Offered;
  /** `changed`: money moved or a visit was booked, so Home is out of date. */
  onClose: (changed: boolean) => void;
}

/** The day, then the start on it, which is held as the client goes on. */
function DayAndTime(props: {
  step: Step;
  before: number;
  days: Days;
  wanted: Wanted | null;
  offered: string | null;
  busy: boolean;
  problem: string | null;
  onDayTaken: () => void;
  onHold: () => void;
}) {
  const { step, before, days } = props;
  const { availability } = days;
  if (availability === null) return null;
  if (step.kind === "date") {
    const later = hasLaterDays(availability)
      ? {
          busy: days.laterAsk === "busy",
          failed: days.laterAsk === "failed",
          onShow: () => void days.showLater(props.wanted),
        }
      : null;
    return (
      <DateStep
        before={before}
        days={availability.days}
        noticeHours={availability.change_notice_hours}
        offered={props.offered}
        chosen={days.date}
        later={later}
        onChoose={days.chooseDate}
        onNext={props.onDayTaken}
      />
    );
  }
  const day = availability.days.find((each) => each.date === days.date);
  if (step.kind !== "window" || day === undefined) return null;
  return (
    <TimeStep
      before={before}
      day={day}
      minutes={availability.service.minutes}
      noticeHours={availability.change_notice_hours}
      chosen={days.chosenStart}
      busy={props.busy}
      problem={props.problem}
      onChoose={days.setChosenStart}
      onNext={props.onHold}
    />
  );
}

/** The steps once a start is held: paying for it, and what came of that. */
function HeldSteps(props: {
  step: Step;
  moving: MoveTerms | undefined;
  busy: boolean;
  problem: string | null;
  reminders: boolean | null;
  remind: boolean;
  onRemind: (remind: boolean) => void;
  onPay: (hold: Hold) => void;
  onHeld: (hold: Hold) => void;
  onPickAgain: () => void;
  onClose: () => void;
}) {
  const { step, reminders } = props;
  switch (step.kind) {
    case "pay":
      return (
        <PayStep
          hold={step.hold}
          moving={props.moving}
          busy={props.busy}
          problem={props.problem}
          askToRemind={reminders !== true}
          remind={props.remind}
          onRemind={props.onRemind}
          onPay={() => {
            props.onPay(step.hold);
          }}
          onHold={props.onHeld}
        />
      );
    case "failed":
      return (
        <FailedStep
          hold={step.hold}
          busy={props.busy}
          onRetry={() => {
            props.onPay(step.hold);
          }}
        />
      );
    case "expired":
      return <ExpiredStep onPickAgain={props.onPickAgain} />;
    case "confirming":
      return <WaitStep text={step.paidIn === true ? booking.paidIn : booking.confirming} />;
    case "confirmed":
      return (
        <ConfirmedStep
          hold={step.hold}
          moved={props.moving !== undefined}
          reminded={reminders === true}
          onDone={props.onClose}
        />
      );
    case "slow":
      return (
        <WaitStep text={step.paid || reminders === true ? booking.slow : booking.slowQuiet} onClose={props.onClose} />
      );
    case "refunded":
      return <WaitStep text={booking.refunded} onClose={props.onClose} />;
    // The steps before a window is held, which the sheet draws itself.
    case "loading":
    case "broken":
    case "service":
    case "address":
    case "notServed":
    case "date":
    case "window":
      return null;
  }
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
  const [busy, once] = useOneAtATime();
  const [problem, setProblem] = useState<string | null>(null);
  const [remind, setRemind] = useState(false);
  const sheet = useSheetData({ dispatch, movingId, firstDay, offeredDate, offeredWindow, wanted, setWanted });
  const { days, reminders, setReminders, addressFirst, askForAddress, showNotServed, load, pick } = sheet;
  const { availability, date, chosenStart } = days;

  // Each step's heading takes the focus the last step's button took with it, as it does when "Later dates" goes with
  // the last of them.
  const daysShown = availability?.days.length;
  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>(`#${TITLE_ID}`) ?? null);
  }, [step.kind, daysShown]);

  const close = () => dialog.current?.close();

  const holdStart = () =>
    once(async () => {
      if (wanted === null || date === null || chosenStart === null) return;
      setProblem(null);
      const answer = await api.hold(wanted, date, chosenStart, movingId);
      if (answer.ok) dispatch({ kind: "held", hold: answer.body });
      else if (answer.code === "taken") {
        setProblem(booking.window.gone);
        await days.askAgainFrom(wanted, date);
      } else if (answer.code === "address_required") askForAddress(true);
      else if (answer.code === "not_served") showNotServed();
      else setProblem(booking.failedToStart);
    });

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
    once,
    setProblem,
  });

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
        <DayAndTime
          step={step}
          before={before}
          days={days}
          wanted={wanted}
          offered={offeredDate ?? null}
          busy={busy}
          problem={problem}
          onDayTaken={() => {
            dispatch({ kind: "dayTaken" });
          }}
          onHold={() => void holdStart()}
        />
        <HeldSteps
          step={step}
          moving={moving}
          busy={busy}
          problem={problem}
          reminders={reminders}
          remind={remind}
          onRemind={setRemind}
          onPay={(hold) => void payFor(hold)}
          onHeld={(hold) => {
            dispatch({ kind: "held", hold });
          }}
          onPickAgain={() => void load(wanted)}
          onClose={close}
        />
      </SheetPanel>
    </Sheet>
  );
}
