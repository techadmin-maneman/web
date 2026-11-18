import { Disclosure } from "@maneman/ui/Disclosure";
import { referral } from "../../content/referral.ts";
import styles from "./Invite.module.css";

function Steps() {
  return (
    <ol class={styles.stepList}>
      {referral.howItWorks.steps.map((step) => (
        <li key={step.n} class={styles.step}>
          <span class={styles.stepNumber}>{step.n}</span>
          <div>
            <h3 class={styles.stepTitle}>{step.title}</h3>
            <p class={styles.stepLead}>{step.lead}</p>
            <p class={styles.stepBody}>{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * How it works: on a laptop, the steps in the column beside the form; on a phone, folded behind its name, as the
 * client app's look keeps a step to what it asks (ADR 0265). `on` says where this one shows: both, or one alone where
 * the page puts the other elsewhere.
 */
export function HowItWorks(props: { on: "both" | "laptop" | "phone" }) {
  const { title } = referral.howItWorks;
  return (
    <>
      {props.on !== "phone" && (
        <div class={styles.steps}>
          <h2 class={styles.stepsTitle}>{title}</h2>
          <Steps />
        </div>
      )}
      {props.on !== "laptop" && (
        <Disclosure look="ruled" summary={title} className={styles.howFold} summaryClassName={styles.howSummary ?? ""}>
          <Steps />
        </Disclosure>
      )}
    </>
  );
}
