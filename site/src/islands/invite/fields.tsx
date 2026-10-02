// The parts both forms are made of: the pincode they are for, where the hair loss is, the person's fields and the
// button that sends them.

import { ICONS } from "@maneman/brand/icons";
import type { LossExtent } from "../../../../src/config/booking.ts";
import { referral } from "../../content/referral.ts";
import { booking, stageOptions } from "../../content/site.ts";
import type { PincodeAnswer, ReferralReward } from "../../lib/api.ts";
import { formatMobile, isCompleteMobile } from "../../lib/phone.ts";
import { Icon, StageDrawing } from "../Drawings.tsx";
import styles from "./Invite.module.css";
import type { PersonFields } from "./useTurnstileForm.ts";

/** What the island gives either form. */
export interface FormProps {
  answer: PincodeAnswer;
  name: string | null;
  /** The invited page carries someone's invite; the site's own does not. */
  invited: boolean;
  /** The invite is valid, so its visits apply and its referrer is told. */
  credits: boolean;
  /** What a referral earns, as ops set it; null until it is known. */
  reward: ReferralReward | null;
  turnstileSiteKey: string;
  onChangePincode: () => void;
}

/** "For 122018 · Change": the pincode the form is for, and the way back to the field (not drawn). */
export function ForPincode(props: { text: string; onChange: () => void }) {
  return (
    <p class={styles.forPincode}>
      {props.text}
      {" · "}
      <button type="button" class={styles.change} aria-label={referral.pincode.changeLabel} onClick={props.onChange}>
        {referral.pincode.change}
      </button>
    </p>
  );
}

/**
 * Where the hair loss is, as the site's own form has always asked (v2's booking board).
 * An invited friend is never asked: their invite carries no such question.
 */
export function ExtentFieldset(props: { extent: LossExtent; onChange: (extent: LossExtent) => void }) {
  return (
    <fieldset class={styles.group}>
      <legend class={`caps ${styles.legend}`}>{booking.extent}</legend>
      <div class={styles.extents}>
        {stageOptions.map((option) => (
          <label key={option.id} class={`${styles.extent} ${props.extent === option.id ? styles.extentOn : ""}`}>
            <input
              type="radio"
              name="extent"
              class="visually-hidden"
              checked={props.extent === option.id}
              onChange={() => {
                props.onChange(option.id);
              }}
            />
            <StageDrawing hair={option.hair} zone={option.zone} size="small" />
            <span class={styles.extentText}>{option.short}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PersonFieldset(props: {
  fields: PersonFields;
  touched: boolean;
  idPrefix: string;
  consentLabel: string;
  consentNote: string;
  onChange: (fields: PersonFields) => void;
}) {
  const { fields, touched, idPrefix } = props;
  const nameBad = touched && fields.name.trim() === "";
  const mobileBad = touched && !isCompleteMobile(fields.mobile);
  const consentBad = touched && !fields.consent;
  return (
    <>
      <div class={styles.fields}>
        <div>
          <label class={styles.label} for={`${idPrefix}-name`}>
            {referral.form.name}
          </label>
          <input
            id={`${idPrefix}-name`}
            class={`${styles.input} ${nameBad ? styles.bad : ""}`}
            value={fields.name}
            placeholder={referral.form.namePlaceholder}
            autocomplete="name"
            aria-required="true"
            aria-invalid={nameBad}
            aria-describedby={nameBad ? `${idPrefix}-name-error` : undefined}
            onInput={(event) => {
              props.onChange({ ...fields, name: event.currentTarget.value });
            }}
          />
          <div aria-live="polite">
            {nameBad && (
              <div id={`${idPrefix}-name-error`} class={styles.error}>
                {referral.form.nameError}
              </div>
            )}
          </div>
        </div>

        <div>
          <label class={styles.label} for={`${idPrefix}-mobile`}>
            {referral.form.mobile}
          </label>
          <div class={`${styles.mobile} ${mobileBad ? styles.bad : ""}`}>
            <span class={styles.prefix}>+91</span>
            <input
              id={`${idPrefix}-mobile`}
              class={styles.mobileInput}
              value={fields.mobile}
              placeholder={referral.form.mobilePlaceholder}
              inputMode="numeric"
              autocomplete="tel-national"
              aria-required="true"
              aria-invalid={mobileBad}
              aria-describedby={mobileBad ? `${idPrefix}-mobile-error` : undefined}
              onInput={(event) => {
                props.onChange({ ...fields, mobile: formatMobile(event.currentTarget.value) });
              }}
            />
          </div>
          <div aria-live="polite">
            {mobileBad && (
              <div id={`${idPrefix}-mobile-error`} class={styles.error}>
                {referral.form.mobileError}
              </div>
            )}
          </div>
        </div>
      </div>

      <label class={styles.consent}>
        <input
          type="checkbox"
          class="visually-hidden"
          checked={fields.consent}
          aria-required="true"
          aria-invalid={consentBad}
          aria-describedby={consentBad ? `${idPrefix}-consent-error` : undefined}
          onChange={(event) => {
            props.onChange({ ...fields, consent: event.currentTarget.checked });
          }}
        />
        <span class={`${styles.box} ${styles.boxRequired} ${consentBad ? styles.bad : ""}`} aria-hidden="true">
          {fields.consent && <Icon path={ICONS.tick} size={13} stroke={1.7} />}
        </span>
        <span class={styles.consentText}>
          {props.consentLabel}
          {props.consentNote !== "" && <span class={styles.consentNote}>{` ${props.consentNote}`}</span>}
        </span>
      </label>
      <div aria-live="polite">
        {consentBad && (
          <div id={`${idPrefix}-consent-error`} class={styles.error}>
            {referral.form.consentError}
          </div>
        )}
      </div>
    </>
  );
}

/** A form's refusal, and the button that sends it. */
export function Send(props: { failure: string | null; sending: boolean; label: string; sendingLabel: string }) {
  return (
    <>
      <div aria-live="polite">{props.failure !== null && <div class={styles.failure}>{props.failure}</div>}</div>
      <button type="submit" class={`btn btn--lg btn--ink ${styles.submit}`} aria-disabled={props.sending}>
        {props.sending && <Icon path={ICONS.sending} size={15} stroke={1.7} />}
        {props.sending ? props.sendingLabel : props.label}
      </button>
    </>
  );
}
