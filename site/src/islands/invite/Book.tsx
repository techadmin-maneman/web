// The site's own /book (docs/decisions/0051-booking-from-the-site.md): an invite's page without the invite. It shows
// no card, asks where the hair loss is, and books with the invite this browser remembers, if any, whose confirmation
// then says what the landing's does (docs/decisions/0089-an-invite-is-not-lost.md). It asks for the name and number
// first, and keeps them as a lead, then the pincode, the visit and the address, a step at a time (AboutYou.tsx,
// docs/decisions/0116-book-asks-for-the-name-and-number-first.md), in the client app's frame on a phone, with a bar of
// the four steps (FlowFrame.tsx, ADR 0265). Outside production, ?state= opens each state directly (preview.ts).

import { booking } from "../../content/site.ts";
import type { PincodeAnswer } from "../../lib/api.ts";
import { IslandBoundary } from "../IslandBoundary.tsx";
import { AboutYou } from "./AboutYou.tsx";
import { BookingFor, StepLine } from "./fields.tsx";
import type { Plan } from "./flow.ts";
import { BOOK_STEPS, FlowSteps, FlowTop } from "./FlowFrame.tsx";
import styles from "./Invite.module.css";
import { Arrival, confirmation, PincodeAndForm } from "./PageParts.tsx";
import { useLandingData } from "./useLandingData.ts";
import { usePageFlow } from "./usePageFlow.ts";

interface Props {
  turnstileSiteKey: string;
  /** Outside production only: ?state= opens a state directly. */
  allowStateSwitch: boolean;
}

/** The page is headed with what it books: the plan chosen, or the waitlist where we do not come yet. */
function bookingTitle(answer: PincodeAnswer | null, plan: Plan): string {
  if (answer?.served === false) return booking.titleWaitlist;
  if (answer?.served === true && plan === "one_visit") return booking.titleOneVisit;
  return booking.title;
}

/** Which of the four steps the page is at: the name and number, the area, the visit or the list, the address. */
function stepAt(first: boolean, answer: PincodeAnswer | null, step: string): number {
  if (first) return 1;
  if (answer === null) return 2;
  return answer.served && step === "address" ? 4 : 3;
}

/** The way back a step: the browser's Back, by the way each step came. None on the first. */
function backOf(page: ReturnType<typeof usePageFlow>, first: boolean): (() => void) | null {
  if (first) return null;
  if (page.pincode.answer === null) return page.changePerson;
  if (page.state.step === "address") return () => history.back();
  return page.pincode.change;
}

function BookPage(props: Props) {
  const { reward } = useLandingData(false);
  const page = usePageFlow(false, props.allowStateSwitch);

  const done = confirmation(page, null, reward, {
    top: <FlowTop onBack={null} />,
    steps: <FlowSteps at={BOOK_STEPS} onBack={null} />,
    how: "laptop",
  });
  if (done !== null) return done;
  const { step, kept, plan } = page.state;
  const { answer } = page.pincode;
  const first = step === "start" || kept === null;
  const back = backOf(page, first);
  const form = { name: null, invited: false, credits: false, reward, turnstileSiteKey: props.turnstileSiteKey };
  // A phone heads the first step and the list with the page's title; the steps between say only what they ask, and
  // keep the title for a screen reader, which hears where it is from it.
  const titled = first || answer?.served === false;
  return (
    <Arrival top={<FlowTop onBack={back} />} how="laptop">
      <FlowSteps at={stepAt(first, answer, step)} onBack={back} />
      <h1 ref={page.heading} tabIndex={-1} class={titled ? styles.title : `${styles.title ?? ""} ${styles.titlePast ?? ""}`}>
        {bookingTitle(answer, plan)}
      </h1>
      {/* Past the first step a phone goes straight to the form; the headline stays to say what it books. */}
      <div class={kept === null ? styles.offer : `${styles.offer ?? ""} ${styles.offerPast ?? ""}`}>
        {answer?.served === false ? (
          <p>{booking.introWaitlist}</p>
        ) : (
          <>
            <p class={styles.introShort}>{booking.introShort}</p>
            {booking.intro.map((paragraph) => (
              <p key={paragraph} class={styles.introLong}>
                {paragraph}
              </p>
            ))}
          </>
        )}
      </div>
      {first ? (
        <AboutYou turnstileSiteKey={props.turnstileSiteKey} kept={kept} onKept={page.keepPerson} />
      ) : (
        <>
          <div class={answer?.served === true ? `${styles.bookingFor ?? ""} ${styles.bookingForPast ?? ""}` : styles.bookingFor}>
            <BookingFor person={kept} onChange={page.changePerson} />
          </div>
          {answer === null && <StepLine at={2} name={booking.steps.area} focus={false} />}
          <PincodeAndForm page={page} form={form} stage={step === "address" ? "address" : "visit"} />
        </>
      )}
    </Arrival>
  );
}

/** The island as the page mounts it: a throw while it draws is reported, and the way to us shown in its place. */
export default function Book(props: Props) {
  return (
    <IslandBoundary>
      <BookPage {...props} />
    </IslandBoundary>
  );
}
