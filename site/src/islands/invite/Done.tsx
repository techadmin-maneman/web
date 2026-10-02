// Board C4, the landing's confirmations: the consultation booked (or asked for, while self-serve booking is off),
// the number on a waitlist, and the invite that has expired for this friend. The booked one says the same to every
// number, since whoever typed it may not be its owner: the details go to the number on WhatsApp, and the client app
// shows them once its owner signs in with a code (src/policy/site-booking.ts).

import { ICONS } from "@maneman/brand/icons";
import { referral } from "../../content/referral.ts";
import type { ReferralConsultation, ReferralReward, ReferralWaitlist } from "../../lib/api.ts";
import { signInLink } from "../../lib/app-link.ts";
import { ENVIRONMENT } from "../../lib/build.ts";
import { fill } from "../../lib/text.ts";
import { Icon } from "../Drawings.tsx";
import styles from "./Invite.module.css";

type HeadingRef = { current: HTMLHeadingElement | null };

/** A booking's answer, with the number the visitor typed: the answer does not carry it. */
export interface Booking {
  readonly result: ReferralConsultation;
  readonly mobile: string;
}

/** The waitlist's answer, the landing's or /book's: /book's carries the invite this browser remembered, if any. */
export type Listing = Pick<ReferralWaitlist, "area" | "credits" | "invite">;

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

export function Booked(props: { booking: Booking; reward: ReferralReward | null; heading: HeadingRef }) {
  const { result, mobile } = props.booking;
  const asked = result.state === "requested";
  const copy = asked ? referral.requested : referral.booked;
  const credits = result.credits ? referral.booked.credits(props.reward) : null;
  // A request's hour is not fixed yet, so there is nothing in the app to see.
  const app = asked ? null : signInLink(ENVIRONMENT, mobile);
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
        {credits !== null && <p class={styles.doneNote}>{credits}</p>}
        {result.invite === "expired" && <Expired reward={props.reward} />}
        {app !== null && <p class={styles.doneNote}>{referral.booked.appHint}</p>}
        <div class={styles.doneActions}>
          {app !== null && (
            <a class="btn btn--lg btn--ink" href={app}>
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
