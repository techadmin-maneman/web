// The name and the mobile number, as every form that takes them draws them: /book, an invite's page and the try-on's
// gate. Each is required, says what is wrong beneath it as it is marked, and on the gate's ink takes the ink's look.

import { messageLook } from "@maneman/ui/InlineMessage";
import { Label, TextInput } from "@maneman/ui/Field";
import { MobileInput } from "@maneman/ui/MobileInput";
import { formatMobileField } from "@maneman/web-kit/mobile";
import { MOST_NAME_LENGTH } from "@maneman/web-kit/names";
import styles from "./PersonFields.module.css";

/** A form's words for the two fields: the booking forms' (referral.form) or the gate's (tryOn.gate). */
interface PersonWords {
  readonly name: string;
  readonly namePlaceholder: string;
  readonly nameError: string;
  readonly mobile: string;
  readonly mobilePlaceholder: string;
  readonly mobileError: string;
}

interface FieldProps {
  /** The input's id; its error's is this with "-error". */
  readonly id: string;
  readonly value: string;
  readonly bad: boolean;
  readonly words: PersonWords;
  /** On the gate's ink. */
  readonly onInk?: boolean;
  readonly onInput: (value: string) => void;
}

/** What is wrong with a field, said as it is marked. */
function FieldError(props: { id: string; text: string | null; onInk: boolean }) {
  return (
    <div aria-live="polite">
      {props.text !== null && (
        <div
          id={props.id}
          class={messageLook({ tone: "error", ground: props.onInk ? "ink" : "paper", className: styles.error })}
        >
          {props.text}
        </div>
      )}
    </div>
  );
}

export function NameField({ id, value, bad, words, onInk = false, onInput }: FieldProps) {
  return (
    <div>
      <Label htmlFor={id} onInk={onInk}>
        {words.name}
      </Label>
      <TextInput
        onInk={onInk}
        id={id}
        value={value}
        placeholder={words.namePlaceholder}
        autocomplete="name"
        maxLength={MOST_NAME_LENGTH}
        aria-required="true"
        aria-invalid={bad}
        aria-describedby={bad ? `${id}-error` : undefined}
        onInput={(event) => {
          onInput(event.currentTarget.value);
        }}
      />
      <FieldError id={`${id}-error`} text={bad ? words.nameError : null} onInk={onInk} />
    </div>
  );
}

/** The ten digits behind +91, spaced as typed: "98100 00000". */
export function MobileField({ id, value, bad, words, onInk = false, onInput }: FieldProps) {
  return (
    <div>
      <Label htmlFor={id} onInk={onInk}>
        {words.mobile}
      </Label>
      <MobileInput
        onInk={onInk}
        prefix="+91"
        id={id}
        value={value}
        placeholder={words.mobilePlaceholder}
        aria-required="true"
        aria-invalid={bad}
        aria-describedby={bad ? `${id}-error` : undefined}
        onInput={(event) => {
          onInput(formatMobileField(event.currentTarget.value));
        }}
      />
      <FieldError id={`${id}-error`} text={bad ? words.mobileError : null} onInk={onInk} />
    </div>
  );
}
