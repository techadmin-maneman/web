// Board C4, the landing's confirmations: the consultation booked (or asked for, while self-serve booking is off),
// the number on a waitlist, and the invite that has expired for this friend. The booked one also carries what no
// board draws: the number we message, that we come to the address already on the account where there was one, what
// a consultation and fit in one visit holds (ADR 0105), a calendar file for the window, and the way into the client
// app.

import { ICONS } from "@maneman/brand/icons";
import { referral } from "../../content/referral.ts";
import type { ReferralConsultation, ReferralReward, ReferralWaitlist } from "../../lib/api.ts";
import { clientAppOrigin } from "../../lib/app-link.ts";
import { ENVIRONMENT } from "../../lib/build.ts";
import { consultationCalendar } from "../../lib/calendar.ts";
import { bookedHeadline } from "../../lib/dates.ts";
import { downloadFile } from "../../lib/download.ts";
import { fill } from "../../lib/text.ts";
import { Icon } from "../Drawings.tsx";
import styles from "./Invite.module.css";

type HeadingRef = { current: HTMLHeadingElement | null };

/** A booking's answer, with the number the visitor typed and the place they gave: the answer carries neither. */
export interface Booking {
  readonly result: ReferralConsultation;
  readonly mobile: string;
  /** "Sector 65, Gurgaon 122018", as C4 writes it. */
  readonly place: string;
  /** The address typed, in one line, for the calendar file. */
  readonly address: string;
}

/** Where the confirmation says the visit is: the place typed, unless the account's own address was kept. */
function placeShown(booking: Booking): string {
  if (booking.result.address === "on_account") return referral.booked.placeOnAccount;
  return booking.place;
}

/** The waitlist's answer, the landing's or /book's: /book's carries the invite this browser remembered, if any. */
export type Listing = Pick<ReferralWaitlist, "area" | "credits" | "invite">;

export function windowHours(window: ReferralConsultation["window"]): string {
  return referral.consultation.windows.find((option) => option.id === window)?.hours ?? "";
}

/** C4's "Code expired" frame, without "Book anyway": it shows once the booking has been made. */
function Expired(props: { reward: ReferralReward | null }) {
  const { expired } = referral;
  return (
    <div class={styles.doneFrame}>
      <div class={`caps ${styles.doneLabel}`}>{expired.label}</div>
      <h2 class={styles.frameTitle}>{expired.title}</h2>
      <p class={styles.frameBody}>{expired.body(props.reward)}</p>
    </div>
  );
}

/** The calendar entry's note: who comes, and where to manage the visit when there is an app to name. */
function calendarNote(app: string | null): string {
  const { calendarNote: note, calendarApp } = referral.booked;
  if (app === null) return note;
  return `${note} ${fill(calendarApp, { url: app })}`;
}

function saveCalendar(booking: Booking, app: string | null) {
  const { result } = booking;
  const title = result.one_visit ? referral.booked.calendarTitleOneVisit : referral.booked.calendarTitle;
  const location = result.address === "on_account" ? null : booking.address;
  const file = consultationCalendar(result.date, result.window, title, new Date(), {
    location,
    description: calendarNote(app),
  });
  downloadFile(referral.booked.calendarFile, "text/calendar", file);
}

/** What the visit costs now, beside where it is: the consultation nothing, the one visit nothing until the fit. */
const costOf = (result: ReferralConsultation): string =>
  result.one_visit ? referral.booked.payOnceFitted : referral.booked.free;

/** The block's label: booked or asked for, the consultation or the consultation and fit. */
function labelOf(result: ReferralConsultation): string {
  if (result.state === "requested") {
    return result.one_visit ? referral.requested.labelOneVisit : referral.requested.label;
  }
  return result.one_visit ? referral.booked.labelOneVisit : referral.booked.label;
}

export function Booked(props: { booking: Booking; reward: ReferralReward | null; heading: HeadingRef }) {
  const { result, mobile } = props.booking;
  const asked = result.state === "requested";
  const credits = result.credits ? referral.booked.credits(props.reward) : null;
  const headline = bookedHeadline(result.date, windowHours(result.window));
  const app = clientAppOrigin(ENVIRONMENT);
  return (
    <section class={styles.done}>
      <div class={`${styles.doneBlock} on-ink`}>
        <div class={`caps ${styles.doneBlockLabel}`}>{labelOf(result)}</div>
        <Icon path={ICONS.tick} size={26} stroke={1.7} />
        <h1 ref={props.heading} tabIndex={-1} class={styles.doneBlockTitle}>
          {asked ? `${referral.requested.asked} ${headline}` : headline}
        </h1>
        <p class={styles.doneBlockBody}>{asked ? referral.requested.body : referral.booked.body}</p>
        <p class={styles.doneBlockWhere}>{`${placeShown(props.booking)} · ${costOf(result)}`}</p>
      </div>
      <div class={styles.doneAfter}>
        <p class={styles.doneNumber}>{fill(referral.booked.number, { mobile })}</p>
        {result.address === "on_account" && <p class={styles.doneNote}>{referral.booked.addressOnAccount}</p>}
        {result.one_visit && <p class={styles.doneNote}>{referral.booked.oneVisit}</p>}
        {credits !== null && <p class={styles.doneNote}>{credits}</p>}
        {result.invite === "expired" && <Expired reward={props.reward} />}
        <div class={styles.doneActions}>
          {!asked && (
            <button
              type="button"
              class="btn btn--lg btn--ink"
              onClick={() => {
                saveCalendar(props.booking, app);
              }}
            >
              {referral.booked.calendar}
            </button>
          )}
          {!asked && app !== null && (
            <a class="btn btn--lg btn--line-on-paper" href={app}>
              {referral.booked.app}
            </a>
          )}
          <a class="btn btn--lg btn--line-on-paper" href="/">
            {referral.booked.back}
          </a>
        </div>
      </div>
    </section>
  );
}

export function Listed(props: {
  listing: Listing;
  name: string | null;
  reward: ReferralReward | null;
  heading: HeadingRef;
}) {
  const { listed } = referral;
  const { area, credits, invite } = props.listing;
  return (
    <section class={styles.done}>
      <div class={styles.doneFrame}>
        <div class={`caps ${styles.doneLabel}`}>{listed.label}</div>
        <h1 ref={props.heading} tabIndex={-1} class={styles.frameTitle}>
          {area === null ? listed.titleUnknown : fill(listed.title, { area })}
        </h1>
        <p class={styles.frameBody}>
          {listed.body}
          {credits && ` ${props.name === null ? listed.credits : fill(listed.creditsFrom, { name: props.name })}`}
        </p>
      </div>
      <div class={styles.doneAfter}>
        {invite === "expired" && <Expired reward={props.reward} />}
        <div class={styles.doneActions}>
          <a class="btn btn--lg btn--ink" href="/try">
            {listed.tryOn}
          </a>
          <a class="btn btn--lg btn--line-on-paper" href="/">
            {listed.back}
          </a>
        </div>
      </div>
    </section>
  );
}
