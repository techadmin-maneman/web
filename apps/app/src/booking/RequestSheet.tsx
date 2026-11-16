// Request mode (design/client-redesign, "Ask for a time"; docs/client-redesign/PLAN.md, gap G4): while a kind is booked
// with ops, the client picks a day in a fortnight from when the visit may be booked (./request-days.ts) and the part
// of the day that suits them, and Send request opens WhatsApp to ops with the pick written in, for the client to send
// there. Nothing is held or paid until ops confirm.

import { DateStrip, type StripDate } from "@maneman/ui/DateStrip";
import { Segmented } from "@maneman/ui/Segmented";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { apiNow } from "@maneman/web-kit/clock";
import { shortDate, todayInIndia, weekdayDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import type { BookingWindow } from "../api.ts";
import { BOOKING_WINDOW_ORDER, booking, missing, WINDOW_NAMES } from "../content.ts";
import { ActionWithMissing } from "../frame/ActionWithMissing.tsx";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import type { Offered } from "./BookingSheet.tsx";
import { requestDays } from "./request-days.ts";
import { DAY_NAMES } from "./steps/shared.tsx";
import styles from "./booking.module.css";

/** A day as the strip draws it. */
function stripDate(date: string): StripDate {
  return {
    date,
    weekday: DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "",
    number: String(Number(date.slice(8))),
    label: weekdayDate(date),
    open: true,
  };
}

export function RequestSheet(props: {
  /** The message to ops the pick is written into. */
  message: string;
  /** The service by name, where it names more than its kind. */
  what: string | null;
  /** The day and part of the day the app offered, which the sheet opens with. */
  offer: Offered | undefined;
  /** The first day the visit may be booked on, where that is later than tomorrow. */
  from: string | undefined;
  onSent: () => void;
  onClose: () => void;
}) {
  const { me } = useSession();
  const copy = booking.request;
  const dialog = useRef<HTMLDialogElement>(null);
  const days = requestDays(todayInIndia(apiNow()), props.from, props.offer?.date).map(stripDate);
  const offered = days.some((day) => day.date === props.offer?.date) ? (props.offer?.date ?? null) : null;
  const [day, setDay] = useState<string | null>(offered);
  const [part, setPart] = useState<BookingWindow>(props.offer?.window ?? "morning");
  const send = () => {
    if (day === null) return;
    const asked = booking.asking(props.message, {
      day: shortDate(day),
      window: WINDOW_NAMES[part].toLowerCase(),
      name: me.name,
      what: props.what,
    });
    window.open(whatsappWith(asked), "_blank", "noopener");
    props.onSent();
    dialog.current?.close();
  };
  return (
    <Sheet ref={dialog} className={styles.dialog} labelledBy="request-title" onClose={props.onClose}>
      <SheetClose onClose={() => dialog.current?.close()}>{booking.close}</SheetClose>
      <SheetPanel className={styles.sheet}>
        <div className={styles.request}>
          <h2 className={styles.changeTitle} id="request-title">
            {copy.title}
          </h2>
          <p>{copy.lede}</p>
          <VisuallyHidden as="p" id="request-day">
            {copy.day}
          </VisuallyHidden>
          <DateStrip name={copy.day} labelledBy="request-day" days={days} chosen={day} onChoose={setDay} />
          <Segmented
            label={copy.part}
            options={BOOKING_WINDOW_ORDER.map((window) => [window, WINDOW_NAMES[window]] as const)}
            value={part}
            onChange={setPart}
          />
          <p className={styles.requestNote}>{copy.note}</p>
          <ActionWithMissing id="request-missing" missing={day === null ? missing.pickDate : null} onClick={send}>
            {copy.send}
          </ActionWithMissing>
        </div>
      </SheetPanel>
    </Sheet>
  );
}
