// The referral landing at /r/:code (design/phase2/Referral and Waitlist, boards
// C1 to C5), and the site's own /book, which is the same page without the
// invite. One island holds the whole page, because the pincode decides what
// the page is: a consultation form where we come, a waitlist where we do not.
//
// The invite arrives in the page itself: the mm-site Worker writes it onto
// #invite, so the referrer's name is there before any JavaScript runs and the
// preview WhatsApp fetches is the referrer's own card (site/src/worker.ts).
// Where it is missing — local dev, a page served straight from the assets, or
// mm-api not answering the Worker — the island fetches it, and any code books.
// The prices arrive the same way, from the price book, onto <body>, and are
// fetched where they did not (docs/decisions/0073-prices-from-the-price-book.md),
// while the site gives prices at all (PRICES_SHOWN). So does what a referral
// earns, as ops set it (docs/decisions/0107-referral-rewards-in-the-console.md),
// which every sentence that gives a count is built from.
//
// The invite, the prices and the reward are read by useLandingData.ts, the
// pincode check is usePincode.ts, the two forms Consultation.tsx and
// Waitlist.tsx, which send through useTurnstileForm.ts, and the confirmations
// Done.tsx. Outside production, ?state= opens each state directly (preview.ts).
//
// A valid invite is remembered in this browser for 30 days, so /book carries it
// if the friend leaves and books there later (site/src/lib/remembered-invite.ts).

import { useEffect, useRef, useState } from "preact/hooks";
import { referral } from "../../content/referral.ts";
import { booking } from "../../content/site.ts";
import { PRICES_SHOWN } from "../../lib/flags.ts";
import { type Invite as InviteAnswer, type PincodeAnswer } from "../../lib/api.ts";
import { cardPath, HOUSE_CARD } from "../../lib/invite.ts";
import { fill } from "../../lib/text.ts";
import { Consultation, type Plan } from "./Consultation.tsx";
import { Booked, Listed, type Booking, type Listing } from "./Done.tsx";
import { onStepChange, pushStep, startAtPincode } from "./history.ts";
import { HowItWorks } from "./HowItWorks.tsx";
import styles from "./Invite.module.css";
import { codeInPath } from "./page.ts";
import { PincodePanel } from "./PincodePanel.tsx";
import { Prices } from "./Prices.tsx";
import { previewNamed, SAMPLE, sampleBooking } from "./preview.ts";
import { usePincode } from "./usePincode.ts";
import { useLandingData } from "./useLandingData.ts";
import { Waitlist } from "./Waitlist.tsx";
import { CARD_HEIGHT, CARD_WIDTH } from "../../../../src/config/referral-cards.ts";

interface Props {
  turnstileSiteKey: string;
  /** Outside production only: ?state= opens a state directly. */
  allowStateSwitch: boolean;
  /**
   * "invited" is /r/:code, where a friend arrives with someone's invite. "public"
   * is the site's own /book, which shows no card and no invite, and asks where the
   * hair loss is as Phase 1's form did (docs/decisions/0051-booking-from-the-site.md).
   * It books with the invite this browser remembers, if any, and its confirmation
   * then says what the landing's does (docs/decisions/0089-an-invite-is-not-lost.md).
   */
  mode?: "invited" | "public";
}

type State = "arrival" | "booked" | "listed";

/** The site's own page is headed with what it books: the plan chosen, or the waitlist where we do not come yet. */
function bookingTitle(answer: PincodeAnswer | null, plan: Plan): string {
  if (answer?.served === false) return booking.titleWaitlist;
  if (answer?.served === true && plan === "one_visit") return booking.titleOneVisit;
  return booking.title;
}

/** The invite's heading, which for a code we do not know promises nothing the invite would have. */
function inviteHeading(invite: InviteAnswer | null): string {
  if (invite?.state === "unknown") return referral.arrival.unknown.title;
  return referral.arrival.title;
}

export default function Invite(props: Props) {
  const invited = (props.mode ?? "invited") === "invited";
  const { invite, prices, reward } = useLandingData(invited);
  const [state, setState] = useState<State>("arrival");
  // Kept here rather than in the form, so the page's heading follows it and a changed pincode keeps it.
  const [plan, setPlan] = useState<Plan>("consultation");
  const [booked, setBooked] = useState<Booking | null>(null);
  const [listed, setListed] = useState<Listing | null>(null);
  const pincode = usePincode();
  const heading = useRef<HTMLHeadingElement>(null);

  const name = invited ? (invite?.referrer_first_name ?? null) : null;
  // Only a valid invite carries its visits; the API books any other without them.
  const credits = invited && invite?.state === "valid";
  const unknown = invited && invite?.state === "unknown";

  useEffect(() => {
    if (!props.allowStateSwitch) return;
    const found = previewNamed(new URLSearchParams(location.search).get("state"));
    if (found === undefined || found === "arrival") return;
    if (found === "served") pincode.setAnswer(SAMPLE.served);
    if (found === "unserved") pincode.setAnswer(SAMPLE.unserved);
    if (found === "booked" || found === "requested" || found === "expired") {
      setBooked(sampleBooking(found));
      setState("booked");
    }
    if (found === "listed") {
      setListed({
        area: SAMPLE.unserved.area,
        credits: true,
        invite: "valid",
        pincode: SAMPLE.unserved.pincode,
        alerted: true,
      });
      setState("listed");
    }
  }, [props.allowStateSwitch]);

  useEffect(() => {
    startAtPincode();
  }, []);

  // Back and Forward move between the page's steps; a confirmation shows again only while this page holds it.
  useEffect(
    () =>
      onStepChange((entry) => {
        if (entry.step === "done" && booked !== null) {
          setState("booked");
          return;
        }
        if (entry.step === "done" && listed !== null) {
          setState("listed");
          return;
        }
        setState("arrival");
        pincode.show(entry.answer);
      }),
    [booked, listed],
  );

  useEffect(() => {
    if (state !== "arrival") {
      globalThis.scrollTo(0, 0);
      heading.current?.focus();
    }
  }, [state]);

  const formProps = {
    name,
    invited,
    credits,
    reward,
    turnstileSiteKey: props.turnstileSiteKey,
    onChangePincode: pincode.change,
  };
  const offer = credits && reward !== null ? referral.arrival.offer(reward) : null;

  if (state === "booked" && booked !== null) return <Booked booking={booked} reward={reward} heading={heading} />;
  if (state === "listed" && listed !== null) {
    return <Listed listing={listed} name={name} reward={reward} heading={heading} />;
  }
  const { answer } = pincode;
  return (
    <section class={styles.arrival}>
      <div class={`${styles.inner} ${styles.grid}`}>
        <div class={styles.lead}>
          {invited && !unknown && (
            <div class={`caps ${styles.from}`}>
              {name === null ? referral.arrival.unnamed : fill(referral.arrival.invited, { name })}
            </div>
          )}
          <h1 ref={heading} tabIndex={-1} class={styles.title}>
            {invited ? inviteHeading(invite) : bookingTitle(answer, plan)}
          </h1>
          <div class={styles.offer}>
            {!invited && <p>{booking.intro}</p>}
            {offer !== null && <p>{offer}</p>}
            {unknown && (
              <p>
                <span class={styles.unknownTitle}>{referral.arrival.unknown.notice}</span>
                <span class={styles.unknownBody}>{referral.arrival.unknown.body(reward)}</span>
              </p>
            )}
          </div>
          {PRICES_SHOWN && <Prices words={prices} />}
          <PincodePanel check={pincode} />

          {answer?.served === true && (
            <Consultation
              {...formProps}
              answer={answer}
              plan={plan}
              onPlanChange={setPlan}
              onBooked={(result) => {
                setBooked(result);
                setListed(null);
                setState("booked");
                pushStep("done", answer);
              }}
            />
          )}
          {answer?.served === false && (
            <Waitlist
              {...formProps}
              answer={answer}
              onListed={(result) => {
                setListed(result);
                setBooked(null);
                setState("listed");
                pushStep("done", answer);
              }}
            />
          )}
        </div>

        <div class={styles.aside}>
          {invited && (
            <img
              class={styles.inviteCard}
              src={invite === null ? HOUSE_CARD : cardPath(invite, codeInPath())}
              width={CARD_WIDTH}
              height={CARD_HEIGHT}
              alt=""
              onError={(event) => {
                event.currentTarget.src = HOUSE_CARD;
              }}
            />
          )}
          <HowItWorks />
        </div>
      </div>
    </section>
  );
}
