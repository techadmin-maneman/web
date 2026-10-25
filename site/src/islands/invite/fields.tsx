// The parts both forms are made of: the pincode they are for, the person's fields, the
// invite /book remembers, and the button that sends them; and /book's steps, with the name and number it kept first.

import { capsLook } from "@maneman/ui/Caps";
import { messageLook } from "@maneman/ui/InlineMessage";
import { Button } from "@maneman/ui/Button";
import { Checkbox } from "@maneman/ui/Field";
import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { useEffect, useRef } from "preact/hooks";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { CLIENT_WORDS } from "@maneman/web-kit/client-words";
import { NoticeLine } from "@maneman/ui/NoticeLine";
import { ICONS } from "@maneman/brand/icons";
import { referral } from "../../content/referral.ts";
import { booking, whatsapp, type NoticeWords } from "../../content/site.ts";
import type { PincodeAnswer, ReferralReward } from "../../lib/api.ts";
import { fill } from "../../lib/text.ts";
import { MobileField, NameField } from "../PersonFields.tsx";
import shared from "./Invite.module.css";
import styles from "./fields.module.css";
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

/** "For 122018 · Change": the pincode the form is for, and the way back to the field. */
export function ForPincode(props: { text: string; onChange: () => void }) {
  return (
    <p class={shared.forPincode}>
      {props.text}
      {" · "}
      <TextButton aria-label={referral.pincode.changeLabel} onClick={props.onChange}>
        {referral.pincode.change}
      </TextButton>
    </p>
  );
}

export function PersonFieldset(props: {
  fields: PersonFields;
  /** The fields to mark as wrong. */
  bad: readonly PersonField[];
  idPrefix: string;
  consentLabel: NoticeWords;
  consentNote: string;
  onChange: (fields: PersonFields) => void;
}) {
  const { fields, idPrefix } = props;
  return (
    <>
      <div class={shared.fields}>
        <NameField
          id={`${idPrefix}-name`}
          value={fields.name}
          bad={props.bad.includes("name")}
          words={referral.form}
          onInput={(name) => {
            props.onChange({ ...fields, name });
          }}
        />
        <MobileField
          id={`${idPrefix}-mobile`}
          value={fields.mobile}
          bad={props.bad.includes("mobile")}
          words={referral.form}
          onInput={(mobile) => {
            props.onChange({ ...fields, mobile });
          }}
        />
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
        terms={
          fields.terms === null
            ? undefined
            : {
                checked: fields.terms,
                bad: props.bad.includes("terms"),
                onChange: (terms) => {
                  props.onChange({ ...fields, terms });
                },
              }
        }
      />
    </>
  );
}

/** An agreement's box: its line, linking to its full notice, and a note after it, "Required" or "Optional". */
export function AgreementBox(props: {
  checked: boolean;
  label: NoticeWords;
  note: string;
  onChange: (checked: boolean) => void;
  /** Where the agreement is required: marked and described by its error. */
  required?: { bad: boolean; errorId: string };
}) {
  const { required } = props;
  return (
    <Checkbox
      className={shared.consent}
      checked={props.checked}
      aria-required={required === undefined ? undefined : "true"}
      aria-invalid={required?.bad}
      aria-describedby={required?.bad === true ? required.errorId : undefined}
      onChange={(event) => {
        props.onChange(event.currentTarget.checked);
      }}
      label={
        <span class={shared.consentText}>
          <NoticeLine line={props.label} href={props.label.href} more={CLIENT_WORDS.noticeMore} />
          {props.note !== "" && <span class={shared.consentNote}>{` ${props.note}`}</span>}
        </span>
      }
    />
  );
}

/** The box a form that books asks the visitor to tick: their agreement to the terms and the privacy policy. */
interface TermsTick {
  readonly checked: boolean;
  readonly bad: boolean;
  readonly onChange: (checked: boolean) => void;
}

/**
 * The agreement a form needs, required, with its error once the form is checked; then, on a form that books, the box
 * that agrees to the terms and the privacy policy, else the line that says they apply.
 */
export function ConsentBox(props: {
  checked: boolean;
  bad: boolean;
  idPrefix: string;
  label: NoticeWords;
  note: string;
  onChange: (checked: boolean) => void;
  terms?: TermsTick | undefined;
}) {
  const { bad, idPrefix } = props;
  return (
    <>
      <AgreementBox
        checked={props.checked}
        label={props.label}
        note={props.note}
        onChange={props.onChange}
        required={{ bad, errorId: `${idPrefix}-consent-error` }}
      />
      <div aria-live="polite">
        {bad && (
          <div id={`${idPrefix}-consent-error`} class={messageLook({ tone: "error", className: shared.error })}>
            {referral.form.consentError}
          </div>
        )}
      </div>
      {props.terms === undefined ? <LegalLinks /> : <TermsBox idPrefix={idPrefix} tick={props.terms} />}
    </>
  );
}

/** "I agree to the Terms and Conditions and the Privacy Policy.", required, each a link in a new tab. */
function TermsBox({ idPrefix, tick }: { idPrefix: string; tick: TermsTick }) {
  const words = referral.form.agree;
  const errorId = `${idPrefix}-terms-error`;
  return (
    <>
      <Checkbox
        className={shared.consent}
        checked={tick.checked}
        aria-required="true"
        aria-invalid={tick.bad}
        aria-describedby={tick.bad ? errorId : undefined}
        onChange={(event) => {
          tick.onChange(event.currentTarget.checked);
        }}
        label={
          <span class={shared.consentText}>
            {words.before}
            <TextLink inline newTab href="/terms">
              {words.terms}
            </TextLink>
            {words.between}
            <TextLink inline newTab href="/privacy">
              {words.privacy}
            </TextLink>
            {words.after}
          </span>
        }
      />
      <div aria-live="polite">
        {tick.bad && (
          <div id={errorId} class={messageLook({ tone: "error", className: shared.error })}>
            {referral.form.agreeError}
          </div>
        )}
      </div>
    </>
  );
}

/** The terms the form binds the visitor to, and the privacy notice, each a link, beneath its agreement. */
function LegalLinks() {
  const words = referral.form.legal;
  return (
    <p class={styles.legal}>
      {words.before}
      <TextLink inline href="/terms">
        {words.terms}
      </TextLink>
      {words.between}
      <TextLink inline href="/privacy">
        {words.privacy}
      </TextLink>
      {words.after}
    </p>
  );
}

/**
 * /book's progress, "Step 2 of 4 · Your area". The address, once Continue opens it, and the name and
 * number, once the visitor comes back to them, bring the line to the top and give it focus, so a screen reader hears
 * where it is. Elsewhere the pincode's field or its answer takes focus instead.
 */
export function StepLine(props: { at: number; name: string; focus: boolean }) {
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!props.focus) return;
    line.current?.focus({ preventScroll: true });
    line.current?.scrollIntoView({ block: "start" });
  }, [props.focus]);
  return (
    <p ref={line} tabIndex={-1} data-says-where class={capsLook(shared.step)}>
      {fill(booking.step, { at: String(props.at), name: props.name })}
    </p>
  );
}

/** "For Karan Bhatia, +91 98100 00002 · Change": the name and number /book kept first, and the way back to them. */
export function BookingFor(props: { person: PersonFields; onChange: () => void }) {
  return (
    <p class={shared.forPincode}>
      {fill(booking.bookingFor, { name: props.person.name.trim(), mobile: props.person.mobile })}
      {" · "}
      <TextButton aria-label={booking.changeYouLabel} onClick={props.onChange}>
        {booking.changeYou}
      </TextButton>
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
      <div aria-live="polite">
        {line !== null && (
          <div class={messageLook({ tone: "error", className: shared.failure })}>
            {line}
            {line === referral.errors.rateLimited && (
              <>
                {" "}
                <TextLink inline href={whatsappChat(whatsapp.number)}>
                  {referral.errors.reachUs}
                </TextLink>
              </>
            )}
          </div>
        )}
      </div>
      <Button
        variant="primary"
        size="action"
        className={styles.submit}
        type="submit"
        aria-disabled={props.sending}
        icon={props.sending ? ICONS.sending : undefined}
      >
        {props.sending ? props.sendingLabel : props.label}
      </Button>
    </>
  );
}

/**
 * On /book, the invite this browser remembers, said before the form sends it: who is told of the fit, and the choice
 * to go on without it.
 */
export function RememberedInvite(props: { line: string; without: string; onWithout: () => void }) {
  return (
    <div class={shared.remembered}>
      <p class={shared.told}>{props.line}</p>
      <TextButton onClick={props.onWithout}>{props.without}</TextButton>
    </div>
  );
}
