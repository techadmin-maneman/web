// The landing's confirmations: the consultation booked (or asked for, while self-serve booking is off),
// the number on a waitlist, and the invite that has expired for this friend. The booked one says the same to every
// number, since whoever typed it may not be its owner (src/policy/site-booking.ts): it restates only the day and window
// picked, the details go to the number on WhatsApp, and the client app shows them once its owner signs in with a code.
// It also says whether the discount code sent with it stands (ADR 0108).

import { ICONS } from "@maneman/brand/icons";
import { rupees } from "@maneman/web-kit/money";
import { googleCalendarLink, icsHref, type CalendarEntry } from "../../../../src/lib/calendar.ts";
import { windowSpan } from "../../../../src/config/scheduling.ts";
import { referral } from "../../content/referral.ts";
import type { Consultation, ReferralConsultation, ReferralReward, ReferralWaitlist } from "../../lib/api.ts";
import { clientAppOrigin, signInLink } from "../../lib/app-link.ts";
import { ENVIRONMENT } from "../../lib/build.ts";
import { longDay } from "../../lib/dates.ts";
import { fill } from "../../lib/text.ts";
import { Icon } from "../Drawings.tsx";
import styles from "./Invite.module.css";

type HeadingRef = { current: HTMLHeadingElement | null };

/**
 * A booking's answer, with the number the visitor typed and the discount code they sent: the answer carries neither.
 * Only the site's own page sends a code, and only its answer says whether it stands.
 */
export interface Booking {
  readonly result: ReferralConsultation | Consultation;
  readonly mobile: string;
  /** As it was sent; null for none. */
  readonly code: string | null;
}

type StandingCode = NonNullable<Consultation["discount_code"]>;

/**
 * The waitlist's answer, the landing's or /book's: /book's carries the invite this browser remembered, if any. With it,
 * the pincode the person gave and whether they asked to be told when we come, which alone earns a promise of a message.
 */
export type Listing = Pick<ReferralWaitlist, "area" | "credits" | "invite"> & {
  readonly pincode: string;
  readonly alerted: boolean;
};

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

/**
 * Opens the app's sign-in with the number filled in. The number is added only as the link is followed, so no
 * analytics tag that reads the page's links ever sees it. A click asking for a new tab opens the plain sign-in.
 */
function openApp(event: MouseEvent, appOrigin: string, mobile: string): void {
  const plainClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  if (!plainClick) return;
  event.preventDefault();
  window.location.assign(signInLink(appOrigin, mobile));
}

/** What a code takes off the hair system's price, before GST: "Rs. 1,000 off", or "10% off, up to Rs. 2,000". */
function offOf(standing: StandingCode): string {
  const words = referral.booked.code;
  if (standing.kind === "amount") return words.amountOff(rupees(standing.value));
  return words.percentOff(standing.value, standing.cap === null ? null : rupees(standing.cap));
}

/** What the confirmation says of the code sent: what it takes off when they pay, or that the booking stands without. */
function codeNote(booking: Booking): string | null {
  if (booking.code === null) return null;
  const standing = "discount_code" in booking.result ? booking.result.discount_code : null;
  if (standing === null) return referral.booked.code.notApplied(booking.code.toUpperCase());
  return referral.booked.code.applied(standing.code, offOf(standing));
}

/** The window's hours as the form offered them: "12 to 4 pm". */
const hoursOf = (window: Booking["result"]["window"]): string =>
  referral.consultation.windows.find((option) => option.id === window)?.hours ?? "";

/** Google's link, and the .ics file for every other calendar, holding the window booked. */
function AddToCalendar(props: { result: Booking["result"]; ready: string }) {
  const { calendar } = referral.booked;
  const { result } = props;
  const entry: CalendarEntry = {
    title: result.one_visit ? calendar.title.oneVisit : calendar.title.consultation,
    ...windowSpan(result.date, result.window),
    details: calendar.details(hoursOf(result.window), props.ready),
    uid: `${result.date}-${result.window}@maneman.in`,
  };
  return (
    <div class={styles.calendar}>
      <p class={`caps ${styles.calendarLabel}`}>{calendar.label}</p>
      <div class={styles.doneActions}>
        <a class="btn btn--sm btn--line-on-paper" href={googleCalendarLink(entry)} target="_blank" rel="noopener">
          {calendar.google}
        </a>
        <a class="btn btn--sm btn--line-on-paper" href={icsHref(entry, new Date())} download={calendar.fileName}>
          {calendar.file}
        </a>
      </div>
    </div>
  );
}

/** What the confirmation's ink block says: the day and window once booked, or that we will fix the hour. */
function headlineOf(result: Booking["result"]): { label: string; title: string; body: string } {
  if (result.state === "requested") return referral.requested;
  const { booked } = referral;
  return { label: booked.label, title: booked.when(longDay(result.date), hoursOf(result.window)), body: booked.body };
}

export function Booked(props: { booking: Booking; reward: ReferralReward | null; heading: HeadingRef }) {
  const { result, mobile } = props.booking;
  const copy = headlineOf(result);
  const booked = result.state === "booked";
  const ready = result.one_visit ? referral.booked.ready.oneVisit : referral.booked.ready.consultation;
  const credits = result.credits ? referral.booked.credits(props.reward) : null;
  const code = codeNote(props.booking);
  const app = clientAppOrigin(ENVIRONMENT);
  return (
    <section class={styles.done}>
      <div class={`${styles.doneBlock} on-ink`}>
        <div class={`caps ${styles.doneBlockLabel}`}>{copy.label}</div>
        <Icon path={ICONS.tick} size={26} stroke={1.7} />
        <h1 ref={props.heading} tabIndex={-1} class={styles.doneBlockTitle}>
          {copy.title}
        </h1>
        <p class={styles.doneBlockBody}>{fill(copy.body, { mobile })}</p>
      </div>
      <div class={styles.doneAfter}>
        {booked && <p class={styles.doneNote}>{ready}</p>}
        {code !== null && <p class={styles.doneNote}>{code}</p>}
        {credits !== null && <p class={styles.doneNote}>{credits}</p>}
        {result.invite === "expired" && <Expired reward={props.reward} />}
        {booked && <AddToCalendar result={result} ready={ready} />}
        {app !== null && <p class={styles.doneNote}>{referral.booked.appHint}</p>}
        <div class={styles.doneActions}>
          {app !== null && (
            <a
              class="btn btn--lg btn--ink"
              href={app}
              onClick={(event) => {
                openApp(event, app, mobile);
              }}
            >
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
  const { area, credits, invite, pincode, alerted } = props.listing;
  const lines = [
    ...(alerted ? [fill(listed.alerted, { pincode })] : []),
    ...(credits
      ? [
          props.name === null
            ? fill(listed.credits, { pincode })
            : fill(listed.creditsFrom, { name: props.name, pincode }),
        ]
      : []),
  ];
  return (
    <section class={styles.done}>
      <div class={styles.doneFrame}>
        <div class={`caps ${styles.doneLabel}`}>{listed.label}</div>
        <h1 ref={props.heading} tabIndex={-1} class={styles.frameTitle}>
          {area === null ? listed.titleUnknown : fill(listed.title, { area })}
        </h1>
        {lines.length > 0 && <p class={styles.frameBody}>{lines.join(" ")}</p>}
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
