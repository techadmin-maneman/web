// The landing's confirmations: the consultation booked (or asked for, while self-serve booking is off),
// the number on a waitlist, and the invite that has expired for this friend. The booked one says the same to every
// number, since whoever typed it may not be its owner (src/policy/site-booking.ts): it restates only the day and window
// picked, the details go to the number on WhatsApp, and the client app shows them once its owner signs in with a code.
// It also says whether the discount code sent with it stands (ADR 0108).

import { capsLook } from "@maneman/ui/Caps";
import { ButtonLink } from "@maneman/ui/Button";
import { ICONS } from "@maneman/brand/icons";
import { rupees } from "@maneman/web-kit/money";
import { googleCalendarLink, icsHref, type CalendarEntry } from "@rules/lib/calendar.ts";
import { windowSpan } from "@rules/config/scheduling.ts";
import { timeRange, UNBROKEN } from "@rules/lib/time-range.ts";
import { referral } from "../../content/referral.ts";
import type { Consultation, ReferralReward } from "../../lib/api.ts";
import { clientAppOrigin, signInLink } from "../../lib/app-link.ts";
import { ENVIRONMENT } from "../../lib/build.ts";
import { longDay } from "../../lib/dates.ts";
import { fill } from "../../lib/text.ts";
import { Icon } from "@maneman/ui/Icon";
import styles from "./Invite.module.css";
import type { Booking, Listing } from "./outcomes.ts";

type HeadingRef = { current: HTMLHeadingElement | null };

type StandingCode = NonNullable<Consultation["discount_code"]>;

/** C4's "Code expired" frame, without "Book anyway": it shows once the booking has been made. */
function Expired(props: { reward: ReferralReward | null }) {
  const { expired } = referral;
  return (
    <div class={styles.doneFrame}>
      <div class={capsLook(styles.doneLabel)}>{expired.label}</div>
      <h2 class={styles.frameTitle}>{expired.title}</h2>
      <p class={styles.frameBody}>{expired.body(props.reward)}</p>
    </div>
  );
}

/** A click as both Preact and the shared link hand it over. */
interface Click {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  preventDefault(): void;
}

/**
 * Opens the app's sign-in with the number filled in. The number is added only as the link is followed, so no
 * analytics tag that reads the page's links ever sees it. A click asking for a new tab opens the plain sign-in.
 */
function openApp(event: Click, appOrigin: string, mobile: string): void {
  const plainClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  if (!plainClick) return;
  event.preventDefault();
  window.location.assign(signInLink(appOrigin, mobile));
}

/** What a code takes off the hair system's price, before GST: "Rs. 1,000 off", or "10% off, up to Rs. 2,000". */
function offOf(standing: StandingCode): string {
  const words = referral.booked.code;
  if (standing.kind === "amount") return fill(words.amountOff, { amount: rupees(standing.value) });
  const percent = String(standing.value);
  if (standing.cap === null) return fill(words.percentOff, { percent });
  return fill(words.percentOffCapped, { percent, cap: rupees(standing.cap) });
}

/** What the confirmation says of the code sent: what it takes off when they pay, or that the booking stands without. */
function codeNote(booking: Booking): string | null {
  if (booking.code === null) return null;
  const standing = "discount_code" in booking.result ? booking.result.discount_code : null;
  const words = referral.booked.code;
  if (standing === null) return fill(words.notApplied, { code: booking.code.toUpperCase() });
  return fill(words.applied, { code: standing.code, off: offOf(standing) });
}

/** The window's hours that day, as the booking answered: "12–4 pm". */
const hoursOf = (result: Booking["result"]): string => timeRange(result.hours.start, result.hours.end, UNBROKEN);

/** Google's link, and the .ics file for every other calendar, holding the window booked. */
function AddToCalendar(props: { result: Booking["result"]; ready: string }) {
  const { calendar } = referral.booked;
  const { result } = props;
  const entry: CalendarEntry = {
    title: result.one_visit ? calendar.title.oneVisit : calendar.title.consultation,
    ...windowSpan(result.date, result.hours),
    // A calendar wraps as it likes, so its hours keep plain spaces.
    details: fill(calendar.details, { hours: timeRange(result.hours.start, result.hours.end), ready: props.ready }),
    uid: `${result.date}-${result.window}@maneman.in`,
  };
  return (
    <div class={styles.calendar}>
      <p class={capsLook(styles.calendarLabel)}>{calendar.label}</p>
      <div class={styles.doneActions}>
        <ButtonLink variant="outline" size="small" href={googleCalendarLink(entry)} target="_blank" rel="noopener">
          {calendar.google}
        </ButtonLink>
        <ButtonLink variant="outline" size="small" href={icsHref(entry, new Date())} download={calendar.fileName}>
          {calendar.file}
        </ButtonLink>
      </div>
    </div>
  );
}

/** What the confirmation's ink block says: the day and window once booked, or that we will fix the hour. */
function headlineOf(result: Booking["result"]): { label: string; title: string; body: string } {
  if (result.state === "requested") return referral.requested;
  const { booked } = referral;
  const title = fill(booked.when, { day: longDay(result.date), hours: hoursOf(result) });
  return { label: booked.label, title, body: booked.body };
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
        <div class={capsLook(styles.doneBlockLabel)}>{copy.label}</div>
        <Icon d={ICONS.tick} size={26} stroke={1.7} />
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
            <ButtonLink
              variant="primary"
              size="action"
              href={app}
              onClick={(event) => {
                openApp(event, app, mobile);
              }}
            >
              {referral.booked.app}
            </ButtonLink>
          )}
          <ButtonLink variant="outline" size="action" href="/">
            {referral.booked.back}
          </ButtonLink>
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
        <div class={capsLook(styles.doneLabel)}>{listed.label}</div>
        <h1 ref={props.heading} tabIndex={-1} class={styles.frameTitle}>
          {area === null ? listed.titleUnknown : fill(listed.title, { area })}
        </h1>
        {lines.length > 0 && <p class={styles.frameBody}>{lines.join(" ")}</p>}
      </div>
      <div class={styles.doneAfter}>
        {invite === "expired" && <Expired reward={props.reward} />}
        <div class={styles.doneActions}>
          <ButtonLink variant="primary" size="action" href="/try">
            {listed.tryOn}
          </ButtonLink>
          <ButtonLink variant="outline" size="action" href="/">
            {listed.back}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
