import { ICONS } from "@maneman/brand/icons";
import { referral } from "../../content/referral.ts";
import type { PincodeAnswer } from "../../lib/api.ts";
import { fill } from "../../lib/text.ts";
import { Icon } from "../Drawings.tsx";
import styles from "./Invite.module.css";
import type { PincodeCheck } from "./usePincode.ts";

/** Where we come to: the area once ops have named it, its city until then. */
const placeOf = (answer: PincodeAnswer): string => answer.area ?? answer.city ?? answer.pincode;

/** Boards C2 and C3: what the pincode answered, in the navy block's place. */
function PincodeAnswerBlock(props: { answer: PincodeAnswer; heading: { current: HTMLHeadingElement | null } }) {
  const { answer } = props;
  if (answer.served) {
    return (
      <h2 ref={props.heading} tabIndex={-1} class={styles.answer}>
        <Icon path={ICONS.tick} size={21} stroke={1.7} />
        {fill(referral.consultation.served, { area: placeOf(answer) })}
      </h2>
    );
  }
  return (
    <>
      <h2 ref={props.heading} tabIndex={-1} class={styles.answer}>
        {answer.area === null ? referral.waitlist.titleUnknown : fill(referral.waitlist.title, { area: answer.area })}
      </h2>
      <p class={styles.answerBody}>{referral.waitlist.body}</p>
    </>
  );
}

/** The navy block: the pincode field, which the answer replaces in place, with no new page. */
export function PincodePanel(props: { check: PincodeCheck }) {
  const { answer, error } = props.check;
  return (
    <section ref={props.check.panel} class={`${styles.panel} ${answer === null ? "" : styles.answered} on-ink`}>
      {answer !== null ? (
        <PincodeAnswerBlock answer={answer} heading={props.check.answerHeading} />
      ) : (
        <>
          <h2 class={styles.panelTitle}>{referral.pincode.title}</h2>
          <form class={styles.pincodeForm} onSubmit={(event) => void props.check.check(event)} noValidate>
            <div class={styles.pincodeField}>
              <label class={styles.label} for="invite-pincode">
                {referral.pincode.label}
              </label>
              <input
                ref={props.check.field}
                id="invite-pincode"
                class={`${styles.input} ${error === null ? "" : styles.bad}`}
                value={props.check.pincode}
                placeholder={referral.pincode.placeholder}
                inputMode="numeric"
                autocomplete="postal-code"
                aria-required="true"
                aria-invalid={error !== null}
                aria-describedby={error === null ? undefined : "invite-pincode-error"}
                onInput={(event) => {
                  props.check.setPincode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6));
                }}
              />
            </div>
            <button type="submit" class={`btn btn--lg btn--paper ${styles.check}`} aria-disabled={props.check.checking}>
              {props.check.checking ? referral.pincode.checking : referral.pincode.check}
            </button>
          </form>
          <div aria-live="polite">
            {error !== null && (
              <div id="invite-pincode-error" class={styles.error}>
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
