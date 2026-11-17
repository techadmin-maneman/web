// What both booking pages draw (./Landing.tsx, ./Book.tsx): their two columns, the pincode and the form its answer
// opens, a consultation where we come and a waitlist where we do not, and the confirmation that takes the page's place.

import type { ComponentChildren } from "preact";
import type { ReferralReward } from "../../lib/api.ts";
import { Consultation } from "./Consultation.tsx";
import { Booked, Listed } from "./Done.tsx";
import type { FormProps } from "./fields.tsx";
import { HowItWorks } from "./HowItWorks.tsx";
import inviteSheet from "./Invite.module.css";
import styles from "./page-parts.module.css";
import { PincodePanel } from "./PincodePanel.tsx";
import type { PageFlow } from "./usePageFlow.ts";
import { Waitlist } from "./Waitlist.tsx";

/**
 * The page's two columns: what it asks for, and beside it what it holds and how it works; on a phone, under the
 * flow's top bar. `how`: where the column's How it works shows, a page that folds it into a step on a phone saying
 * so (Book.tsx).
 */
export function Arrival(props: {
  children: ComponentChildren;
  top: ComponentChildren;
  aside?: ComponentChildren;
  how?: "both" | "laptop";
}) {
  return (
    <section class={styles.arrival}>
      {props.top}
      <div class={`${styles.inner} ${inviteSheet.grid}`}>
        <div class={inviteSheet.lead}>{props.children}</div>
        <div class={inviteSheet.aside}>
          {props.aside}
          <HowItWorks on={props.how ?? "both"} />
        </div>
      </div>
    </section>
  );
}

/** What stays around the list's confirmation: the flow's top bar, /book's step bar, and where How it works shows. */
export interface ListedFrame {
  readonly top: ComponentChildren;
  readonly steps?: ComponentChildren;
  readonly how: "both" | "laptop";
}

/**
 * The confirmation, once the page holds one and the history is at it; null while the page asks. Booked, the
 * confirmation is the whole screen; on the list, it stays in the flow's frame, beside How it works.
 */
export function confirmation(page: PageFlow, name: string | null, reward: ReferralReward | null, frame: ListedFrame) {
  const { state, heading } = page;
  if (state.view === "booked" && state.booked !== null) {
    return <Booked booking={state.booked} reward={reward} heading={heading} />;
  }
  if (state.view === "listed" && state.listed !== null) {
    return (
      <Arrival top={frame.top} how={frame.how}>
        {frame.steps}
        <Listed listing={state.listed} name={name} reward={reward} heading={heading} />
      </Arrival>
    );
  }
  return null;
}

/** The pincode check, and the form its answer opens: /book's at the step it is at, an invite's all at once. */
export function PincodeAndForm(props: {
  page: PageFlow;
  form: Omit<FormProps, "answer" | "onChangePincode">;
  stage: "all" | "visit" | "address";
}) {
  const { page, form } = props;
  const { answer } = page.pincode;
  const shared = { ...form, onChangePincode: page.pincode.change, person: page.state.kept };
  return (
    <>
      <PincodePanel check={page.pincode} past={props.stage === "address"} />
      {answer?.served === true && (
        <Consultation
          {...shared}
          answer={answer}
          plan={page.state.plan}
          onPlanChange={page.choosePlan}
          stage={props.stage}
          onNext={page.toAddress}
          onBackToVisit={() => {
            history.back();
          }}
          onBooked={page.booked}
        />
      )}
      {answer?.served === false && <Waitlist {...shared} answer={answer} onListed={page.listed} />}
    </>
  );
}
