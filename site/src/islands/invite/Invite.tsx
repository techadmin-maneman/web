// The referral landing at /r/:code, and the site's own /book, which is the same page without the
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
//
// /book asks for the name and number first, and keeps them as a lead, then the
// pincode, the visit and the address, a step at a time (AboutYou.tsx,
// docs/decisions/0116-book-asks-for-the-name-and-number-first.md). The invite's
// page, which the design draws, asks for everything in one form.

import { capsLook } from "@maneman/ui/Caps";
import { useEffect, useRef, useState } from "preact/hooks";
import { inviteReward, referral } from "../../content/referral.ts";
import { booking } from "../../content/site.ts";
import { PRICES_SHOWN } from "../../lib/flags.ts";
import { type Invite as InviteAnswer, type PincodeAnswer } from "../../lib/api.ts";
import { cardPath, HOUSE_CARD } from "../../lib/invite.ts";
import { fill } from "../../lib/text.ts";
import { AboutYou, BOOK_STEPS } from "./AboutYou.tsx";
import { Consultation, type Plan } from "./Consultation.tsx";
import { Booked, Listed, type Booking, type Listing } from "./Done.tsx";
import { BookingFor, StepLine } from "./fields.tsx";
import { currentStep, onStepChange, pushStep, startAtTheStart } from "./history.ts";
import { HowItWorks } from "./HowItWorks.tsx";
import styles from "./Invite.module.css";
import { codeInPath } from "./page.ts";
import { PincodePanel } from "./PincodePanel.tsx";
import { Prices } from "./Prices.tsx";
import { PREVIEW_PERSON, usePreview } from "./preview.ts";
import type { Step } from "./step.ts";
import { usePincode } from "./usePincode.ts";
import type { PersonFields } from "./useTurnstileForm.ts";
import { useLandingData } from "./useLandingData.ts";
import { useLatest } from "../useLatest.ts";
import { Waitlist } from "./Waitlist.tsx";
import { CARD_HEIGHT, CARD_WIDTH } from "@rules/config/referral-cards.ts";
import { IslandBoundary } from "../IslandBoundary.tsx";

interface Props {
  turnstileSiteKey: string;
  /** Outside production only: ?state= opens a state directly. */
  allowStateSwitch: boolean;
  /**
   * "invited" is /r/:code, where a friend arrives with someone's invite. "public"
   * is the site's own /book, which shows no card and no invite, and asks where the
   * hair loss is as the site's first form did (docs/decisions/0051-booking-from-the-site.md).
   * It books with the invite this browser remembers, if any, and its confirmation
   * then says what the landing's does (docs/decisions/0089-an-invite-is-not-lost.md).
   */
  mode?: "invited" | "public";
}

type State = "arrival" | "booked" | "listed";

/** The invite's page asks for everything at once; /book has the visit, then the address. */
function formStage(invited: boolean, step: Step): "all" | "visit" | "address" {
  if (invited) return "all";
  return step === "address" ? "address" : "visit";
}

/** How far back /book's first step is from each step after it, in the browser's history. */
const BACK_TO_START: Partial<Record<Step, number>> = { pincode: 1, form: 2, address: 3 };

/** The site's own page is headed with what it books: the plan chosen, or the waitlist where we do not come yet. */
function bookingTitle(answer: PincodeAnswer | null, plan: Plan): string {
  if (answer?.served === false) return booking.titleWaitlist;
  if (answer?.served === true && plan === "one_visit") return booking.titleOneVisit;
  return booking.title;
}

/** The invite's heading, which for a code we do not know promises nothing the invite would have. */
/** Who the invite is from: a partner, a client who agreed to be named, or no one named. */
function fromLine(name: string | null, partner: string | null): string {
  if (partner !== null) return fill(referral.arrival.partner, { partner });
  return name === null ? referral.arrival.unnamed : fill(referral.arrival.invited, { name });
}

function inviteHeading(invite: InviteAnswer | null): string {
  if (invite?.state === "unknown") return referral.arrival.unknown.title;
  return referral.arrival.title;
}

function InviteForm(props: Props) {
  const invited = (props.mode ?? "invited") === "invited";
  const landing = useLandingData(invited);
  const { invite, prices } = landing;
  const reward = inviteReward(invite, landing.reward);
  const [state, setState] = useState<State>("arrival");
  // Kept here rather than in the form, so the page's heading follows it and a changed pincode keeps it.
  const [plan, setPlan] = useState<Plan>("consultation");
  const [booked, setBooked] = useState<Booking | null>(null);
  const [listed, setListed] = useState<Listing | null>(null);
  const pincode = usePincode();
  const showAnswer = useLatest(pincode.show);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>("start");
  // On /book, the name and number its first step kept.
  const [kept, setKept] = useState<PersonFields | null>(null);

  const name = invited ? (invite?.referrer_first_name ?? null) : null;
  // Only a valid invite carries its visits; the API books any other without them.
  const credits = invited && invite?.state === "valid";
  const unknown = invited && invite?.state === "unknown";

  usePreview(props.allowStateSwitch, (preview) => {
    if (preview.kind === "answer") {
      pincode.setAnswer(preview.answer);
      setKept(PREVIEW_PERSON);
      setStep("form");
    }
    if (preview.kind === "booked") {
      setBooked(preview.booking);
      setState("booked");
    }
    if (preview.kind === "listed") {
      setListed(preview.listing);
      setState("listed");
    }
  });

  useEffect(() => {
    startAtTheStart();
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
        setStep(entry.step === "done" ? "form" : entry.step);
        showAnswer.current(entry.answer);
      }),
    [booked, listed, showAnswer],
  );

  // /book's pincode field takes focus as its step opens, from the name and number or back from the form.
  useEffect(() => {
    if (step === "pincode") pincode.field.current?.focus();
  }, [step, pincode.field]);

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
  const discount = invited && !unknown ? (invite?.discount ?? null) : null;

  function keepPerson(fields: PersonFields) {
    setKept(fields);
    pushStep("pincode", null);
    setStep("pincode");
  }

  /** Back to the name and number, as the browser's Back would go. */
  function changePerson() {
    // Read from the history, where the pincode's answer writes its own entry (usePincode.ts).
    const back = BACK_TO_START[currentStep()];
    if (back === undefined) setStep("start");
    else history.go(-back);
  }

  if (state === "booked" && booked !== null) return <Booked booking={booked} reward={reward} heading={heading} />;
  if (state === "listed" && listed !== null) {
    return <Listed listing={listed} name={name} reward={reward} heading={heading} />;
  }
  const { answer } = pincode;
  const atStart = !invited && (step === "start" || kept === null);
  return (
    <section class={styles.arrival}>
      <div class={`${styles.inner} ${styles.grid}`}>
        <div class={styles.lead}>
          {invited && !unknown && <div class={capsLook(styles.from)}>{fromLine(name, invite?.partner ?? null)}</div>}
          <h1 ref={heading} tabIndex={-1} class={styles.title}>
            {invited ? inviteHeading(invite) : bookingTitle(answer, plan)}
          </h1>
          <div class={styles.offer}>
            {!invited && <p>{answer?.served === false ? booking.introWaitlist : booking.intro}</p>}
            {offer !== null && <p>{offer}</p>}
            {discount !== null && <p>{referral.arrival.discount(discount)}</p>}
            {unknown && (
              <p>
                <span class={styles.unknownTitle}>{referral.arrival.unknown.notice}</span>
                <span class={styles.unknownBody}>{referral.arrival.unknown.body(reward)}</span>
              </p>
            )}
          </div>
          {PRICES_SHOWN && <Prices words={prices} />}
          {atStart ? (
            <AboutYou turnstileSiteKey={props.turnstileSiteKey} kept={kept} onKept={keepPerson} />
          ) : (
            <>
              {kept !== null && <BookingFor person={kept} onChange={changePerson} />}
              {kept !== null && answer === null && (
                <StepLine at={2} of={BOOK_STEPS} name={booking.steps.area} focus={false} />
              )}
              <PincodePanel check={pincode} />

              {answer?.served === true && (
                <Consultation
                  {...formProps}
                  answer={answer}
                  plan={plan}
                  onPlanChange={setPlan}
                  person={kept}
                  stage={formStage(invited, step)}
                  onNext={() => {
                    pushStep("address", answer);
                    setStep("address");
                  }}
                  onBackToVisit={() => {
                    history.back();
                  }}
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
                  person={kept}
                  onListed={(result) => {
                    setListed(result);
                    setBooked(null);
                    setState("listed");
                    pushStep("done", answer);
                  }}
                />
              )}
            </>
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

/** The island as the page mounts it: a throw while it draws is reported, and the way to us shown in its place. */
export default function Invite(props: Props) {
  return (
    <IslandBoundary>
      <InviteForm {...props} />
    </IslandBoundary>
  );
}
