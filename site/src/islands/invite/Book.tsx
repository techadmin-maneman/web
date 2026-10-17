// The site's own /book (docs/decisions/0051-booking-from-the-site.md): an invite's page without the invite. It shows
// no card, asks where the hair loss is, and books with the invite this browser remembers, if any, whose confirmation
// then says what the landing's does (docs/decisions/0089-an-invite-is-not-lost.md). It asks for the name and number
// first, and keeps them as a lead, then the pincode, the visit and the address, a step at a time (AboutYou.tsx,
// docs/decisions/0116-book-asks-for-the-name-and-number-first.md). Outside production, ?state= opens each state
// directly (preview.ts).

import { booking } from "../../content/site.ts";
import type { PincodeAnswer } from "../../lib/api.ts";
import { IslandBoundary } from "../IslandBoundary.tsx";
import { AboutYou } from "./AboutYou.tsx";
import { BookingFor, StepLine } from "./fields.tsx";
import type { Plan } from "./flow.ts";
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

function BookPage(props: Props) {
  const { reward } = useLandingData(false);
  const page = usePageFlow(false, props.allowStateSwitch);

  const done = confirmation(page, null, reward);
  if (done !== null) return done;
  const { step, kept, plan } = page.state;
  const { answer } = page.pincode;
  const form = { name: null, invited: false, credits: false, reward, turnstileSiteKey: props.turnstileSiteKey };
  return (
    <Arrival>
      <h1 ref={page.heading} tabIndex={-1} class={styles.title}>
        {bookingTitle(answer, plan)}
      </h1>
      <div class={styles.offer}>
        <p>{answer?.served === false ? booking.introWaitlist : booking.intro}</p>
      </div>
      {step === "start" || kept === null ? (
        <AboutYou turnstileSiteKey={props.turnstileSiteKey} kept={kept} onKept={page.keepPerson} />
      ) : (
        <>
          <BookingFor person={kept} onChange={page.changePerson} />
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
