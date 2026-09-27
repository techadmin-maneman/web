// Board C4, the landing's confirmations: the consultation booked (or asked for, while self-serve booking is off),
// the number on a waitlist, and the invite that has expired for this friend. The booked one also carries what no
// board draws: the number we message, a calendar file for the window, and the way into the client app.

import { ICONS } from "@maneman/brand/icons";
import { referral } from "../../content/referral.ts";
import type { PincodeAnswer, ReferralConsultation, ReferralWaitlist } from "../../lib/api.ts";
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
}

export function placeOf(answer: PincodeAnswer): string {
  const area = answer.area ?? answer.pincode;
  return answer.city === null ? `${area} ${answer.pincode}` : `${area}, ${answer.city} ${answer.pincode}`;
}

/** The landing's waitlist answer; /book's carries no invite and no credits. */
export type Listing = Pick<ReferralWaitlist, "area" | "credits" | "invite">;

export function windowHours(window: ReferralConsultation["window"]): string {
  return referral.consultation.windows.find((option) => option.id === window)?.hours ?? "";
}

/** C4's "Code expired" frame, without "Book anyway": it shows once the booking has been made. */
function Expired() {
  const { expired } = referral;
  return (
    <div class={styles.doneFrame}>
      <div class={`caps ${styles.doneLabel}`}>{expired.label}</div>
      <h2 class={styles.frameTitle}>{expired.title}</h2>
      <p class={styles.frameBody}>{expired.body}</p>
    </div>
  );
}

function saveCalendar(result: ReferralConsultation) {
  const file = consultationCalendar(result.date, result.window, referral.booked.calendarTitle, new Date());
  downloadFile(referral.booked.calendarFile, "text/calendar", file);
}

export function Booked(props: { booking: Booking; heading: HeadingRef }) {
  const { result, mobile, place } = props.booking;
  const asked = result.state === "requested";
  const headline = bookedHeadline(result.date, windowHours(result.window));
  const app = clientAppOrigin(ENVIRONMENT);
  return (
    <section class={styles.done}>
      <div class={`${styles.doneBlock} on-ink`}>
        <div class={`caps ${styles.doneBlockLabel}`}>{asked ? referral.requested.label : referral.booked.label}</div>
        <Icon path={ICONS.tick} size={26} stroke={1.7} />
        <h1 ref={props.heading} tabIndex={-1} class={styles.doneBlockTitle}>
          {asked ? `${referral.requested.asked} ${headline}` : headline}
        </h1>
        <p class={styles.doneBlockBody}>{asked ? referral.requested.body : referral.booked.body}</p>
        <p class={styles.doneBlockWhere}>{`${place} · ${referral.booked.free}`}</p>
      </div>
      <div class={styles.doneAfter}>
        <p class={styles.doneNumber}>{fill(referral.booked.number, { mobile })}</p>
        {result.credits && <p class={styles.doneNote}>{referral.booked.credits}</p>}
        {result.invite === "expired" && <Expired />}
        <div class={styles.doneActions}>
          {!asked && (
            <button
              type="button"
              class="btn btn--lg btn--ink"
              onClick={() => {
                saveCalendar(result);
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

export function Listed(props: { listing: Listing; name: string | null; heading: HeadingRef }) {
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
        {invite === "expired" && <Expired />}
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
