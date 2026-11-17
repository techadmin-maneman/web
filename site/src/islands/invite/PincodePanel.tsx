import "../refs-as-props.ts";
import { messageLook } from "@maneman/ui/InlineMessage";
import { Label, TextInput } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { ICONS } from "@maneman/brand/icons";
import { referral } from "../../content/referral.ts";
import type { PincodeAnswer } from "../../lib/api.ts";
import { fill } from "../../lib/text.ts";
import { Icon } from "@maneman/ui/Icon";
import { TextButton } from "@maneman/ui/TextLink";
import styles from "./Invite.module.css";
import type { PincodeCheck } from "./usePincode.ts";

/** Where we come to: the area once ops have named it, its city until then. */
const placeOf = (answer: PincodeAnswer): string => answer.area ?? answer.city ?? answer.pincode;

/**
 * What the pincode answered, in the field's place, on navy: where we come, a banner, which on a phone also names the
 * pincode and carries its Change; where we do not, why not.
 */
function PincodeAnswerBlock(props: {
  answer: PincodeAnswer;
  heading: { current: HTMLHeadingElement | null };
  onChange: () => void;
}) {
  const { answer } = props;
  if (answer.served) {
    return (
      <>
        <h2 ref={props.heading} tabIndex={-1} class={styles.answer}>
          <Icon d={ICONS.tick} size="md" />
          <span>
            {fill(referral.consultation.served, { area: placeOf(answer) })}
            <span class={styles.answerPincode}>, {answer.pincode}</span>
          </span>
        </h2>
        <TextButton
          tone="ink"
          className={styles.answerChange}
          aria-label={referral.pincode.changeLabel}
          onClick={props.onChange}
        >
          {referral.pincode.change}
        </TextButton>
      </>
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

/** The panel's classes: the field's, or the answer's on navy; on a phone, none past the visit. */
function panelLook(answer: PincodeAnswer | null, past: boolean): string {
  const looks = [styles.panel];
  if (answer !== null) looks.push(styles.answered, "on-ink");
  if (answer?.served === false) looks.push(styles.answeredNot);
  if (past) looks.push(styles.panelPast);
  return looks.filter(Boolean).join(" ");
}

/**
 * The pincode field, which the answer replaces in place, with no new page. `past`: the address step, where a phone
 * keeps to what it asks.
 */
export function PincodePanel(props: { check: PincodeCheck; past: boolean }) {
  const { answer, error } = props.check;
  return (
    <section ref={props.check.panel} class={panelLook(answer, props.past)}>
      {answer !== null ? (
        <PincodeAnswerBlock answer={answer} heading={props.check.answerHeading} onChange={props.check.change} />
      ) : (
        <>
          <h2 class={styles.panelTitle}>{referral.pincode.title}</h2>
          <form class={styles.pincodeForm} onSubmit={(event) => void props.check.check(event)} noValidate>
            <div class={styles.pincodeField}>
              <Label htmlFor="invite-pincode">{referral.pincode.label}</Label>
              <TextInput
                ref={props.check.field}
                id="invite-pincode"
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
            <Button
              variant="primary"
              size="action"
              className={styles.check}
              type="submit"
              aria-disabled={props.check.checking}
            >
              {props.check.checking ? referral.pincode.checking : referral.pincode.check}
            </Button>
          </form>
          <div aria-live="polite">
            {error !== null && (
              <div id="invite-pincode-error" class={messageLook({ tone: "error", className: styles.error })}>
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
