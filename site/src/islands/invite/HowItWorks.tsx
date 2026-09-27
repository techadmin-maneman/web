import { referral } from "../../content/referral.ts";
import styles from "./Invite.module.css";

/** How it works: the steps beside the form. */
export function HowItWorks() {
  return (
    <div class={styles.steps}>
      <h2 class={`caps ${styles.stepsTitle}`}>{referral.howItWorks.title}</h2>
      <ol class={styles.stepList}>
        {referral.howItWorks.steps.map((step) => (
          <li key={step.n} class={styles.step}>
            <span class={styles.stepNumber}>{step.n}</span>
            <div>
              <h3 class={styles.stepTitle}>{step.title}</h3>
              <p class={styles.stepBody}>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
