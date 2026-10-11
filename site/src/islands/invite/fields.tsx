// The parts both forms are made of: the pincode they are for, where the hair loss is, the person's fields, the
// invite /book remembers, and the button that sends them; and /book's steps, with the name and number it kept first.

import { useEffect, useRef } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import { formatMobileField } from "@maneman/web-kit/mobile";
import { MOST_NAME_LENGTH } from "@maneman/web-kit/names";
import type { LossExtent } from "@rules/config/booking.ts";
import { referral } from "../../content/referral.ts";
import { booking, stageOptions } from "../../content/site.ts";
import type { PincodeAnswer, ReferralReward } from "../../lib/api.ts";
import { fill } from "../../lib/text.ts";
import { Icon, StageDrawing } from "../Drawings.tsx";
import styles from "./Invite.module.css";
import type { PersonField, PersonFields } from "./useTurnstileForm.ts";

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
 * Where the hair loss is, as the site's own form has always asked (v2's booking board). Nothing is chosen until the
 * visitor chooses, and a visitor who skips it is recorded as not saying. An invited friend is never asked: their
 * invite carries no such question.
 */
export function ExtentFieldset(props: { extent: LossExtent | null; onChange: (extent: LossExtent) => void }) {
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
  /** The fields to mark as wrong. */
  bad: readonly PersonField[];
  idPrefix: string;
  consentLabel: string;
  consentNote: string;
  onChange: (fields: PersonFields) => void;
}) {
  const { fields, idPrefix } = props;
  const nameBad = props.bad.includes("name");
  const mobileBad = props.bad.includes("mobile");
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
            maxLength={MOST_NAME_LENGTH}
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
                props.onChange({ ...fields, mobile: formatMobileField(event.currentTarget.value) });
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

      <ConsentBox
        checked={fields.consent}
        bad={props.bad.includes("consent")}
        idPrefix={idPrefix}
        label={props.consentLabel}
        note={props.consentNote}
        onChange={(consent) => {
          props.onChange({ ...fields, consent });
        }}
      />
    </>
  );
}

/** The agreement a form needs, required, with its error once the form is checked. */
export function ConsentBox(props: {
  checked: boolean;
  bad: boolean;
  idPrefix: string;
  label: string;
  note: string;
  onChange: (checked: boolean) => void;
}) {
  const { bad, idPrefix } = props;
  return (
    <>
      <label class={styles.consent}>
        <input
          type="checkbox"
          class="visually-hidden"
          checked={props.checked}
          aria-required="true"
          aria-invalid={bad}
          aria-describedby={bad ? `${idPrefix}-consent-error` : undefined}
          onChange={(event) => {
            props.onChange(event.currentTarget.checked);
          }}
        />
        <span class={`${styles.box} ${styles.boxRequired} ${bad ? styles.bad : ""}`} aria-hidden="true">
          {props.checked && <Icon path={ICONS.tick} size={13} stroke={1.7} />}
        </span>
        <span class={styles.consentText}>
          {props.label}
          {props.note !== "" && <span class={styles.consentNote}>{` ${props.note}`}</span>}
        </span>
      </label>
      <div aria-live="polite">
        {bad && (
          <div id={`${idPrefix}-consent-error`} class={styles.error}>
            {referral.form.consentError}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * /book's progress, "Step 2 of 4 · Your area" (not drawn). The address, once Continue opens it, and the name and
 * number, once the visitor comes back to them, bring the line to the top and give it focus, so a screen reader hears
 * where it is. Elsewhere the pincode's field or its answer takes focus instead.
 */
export function StepLine(props: { at: number; of: number; name: string; focus: boolean }) {
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!props.focus) return;
    line.current?.focus({ preventScroll: true });
    line.current?.scrollIntoView({ block: "start" });
  }, [props.focus]);
  return (
    <p ref={line} tabIndex={-1} class={`caps ${styles.step}`}>
      {fill(booking.step, { at: String(props.at), of: String(props.of), name: props.name })}
    </p>
  );
}

/** "For Karan Bhatia, +91 98100 00002 · Change": the name and number /book kept first, and the way back to them. */
export function BookingFor(props: { person: PersonFields; onChange: () => void }) {
  return (
    <p class={styles.forPincode}>
      {fill(booking.bookingFor, { name: props.person.name.trim(), mobile: props.person.mobile })}
      {" · "}
      <button type="button" class={styles.change} aria-label={booking.changeYouLabel} onClick={props.onChange}>
        {booking.changeYou}
      </button>
    </p>
  );
}

/** Three or more fields marked are counted by the button, since on a phone most of them are out of view. */
function markedLine(marked: number): string | null {
  if (marked < 3) return null;
  return fill(referral.form.marked, { count: String(marked) });
}

/** A form's refusal, or the count of the fields it marked, and the button that sends it. */
export function Send(props: {
  failure: string | null;
  /** How many fields the form marks as wrong. */
  marked: number;
  sending: boolean;
  label: string;
  sendingLabel: string;
}) {
  const line = markedLine(props.marked) ?? props.failure;
  return (
    <>
      <div aria-live="polite">{line !== null && <div class={styles.failure}>{line}</div>}</div>
      <button type="submit" class={`btn btn--lg btn--ink ${styles.submit}`} aria-disabled={props.sending}>
        {props.sending && <Icon path={ICONS.sending} size={15} stroke={1.7} />}
        {props.sending ? props.sendingLabel : props.label}
      </button>
    </>
  );
}

/**
 * On /book, the invite this browser remembers, said before the form sends it: who is told of the fit, and the choice
 * to go on without it.
 */
export function RememberedInvite(props: { line: string; without: string; onWithout: () => void }) {
  return (
    <div class={styles.remembered}>
      <p class={styles.told}>{props.line}</p>
      <button type="button" class={styles.change} onClick={props.onWithout}>
        {props.without}
      </button>
    </div>
  );
}
