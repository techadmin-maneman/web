import { capsLook } from "@maneman/ui/Caps";
import { messageLook } from "@maneman/ui/InlineMessage";
import { Label, TextInput } from "@maneman/ui/Field";
import { MobileInput } from "@maneman/ui/MobileInput";
import { Button } from "@maneman/ui/Button";
import { ICONS } from "@maneman/brand/icons";
import { formatMobileField } from "@maneman/web-kit/mobile";
import { MOST_NAME_LENGTH } from "@maneman/web-kit/names";
import { gateCopy, numberCode as numberCodeWords, tryOn, type Notice } from "../../content/site.ts";
import { NumberCodeField, type CodeFieldClasses } from "../NumberCodeField.tsx";
import type { FormRef } from "../useInvalidFocus.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** The WhatsApp code's field, on the gate's ink. */
const CODE_FIELD: CodeFieldClasses = { hint: styles.codeHint, error: styles.error, again: styles.codeAgain };

/** The code sent to the number typed, while it waits to be entered. */
export interface GateCode {
  readonly value: string;
  readonly failure: string | null;
  readonly checking: boolean;
  readonly onInput: (code: string) => void;
  readonly onAgain: (event: Event) => void;
}

/** The button's words: sending the look, or, once a code is on its way, confirming it. */
function submitLabel(code: GateCode | null, sending: boolean): string {
  if (code?.checking === true) return numberCodeWords.checking;
  if (sending) return tryOn.gate.sending;
  return code === null ? tryOn.gate.submit : tryOn.gate.confirm;
}

/** What is wrong with a field, said as it is marked. */
function FieldError(props: { id: string; text: string | null }) {
  return (
    <div aria-live="polite">
      {props.text !== null && (
        <div id={props.id} class={messageLook({ tone: "error", ground: "ink", className: styles.error })}>
          {props.text}
        </div>
      )}
    </div>
  );
}

/**
 * Step four: where to send the look on WhatsApp, before it is made. Both fields are needed (ADR 0104), and the number
 * is proved with the WhatsApp code sent to it before the look is made.
 */
export function Gate(props: {
  notice: Notice;
  name: string;
  mobile: string;
  nameBad: boolean;
  mobileBad: boolean;
  failure: string | null;
  sending: boolean;
  /** Null until a code is on its way to the number typed. */
  code: GateCode | null;
  heading: HeadingRef;
  form: FormRef;
  onName: (name: string) => void;
  onMobile: (mobile: string) => void;
  onSubmit: (event: Event) => void;
}) {
  const { nameBad, mobileBad, code } = props;
  const busy = props.sending || code?.checking === true;
  const words = gateCopy(props.notice);
  return (
    <div class={styles.gate}>
      <div class={styles.gateImage}>
        <div class={styles.gateFrame}>
          <div class={styles.gateLeft} />
          <div class={styles.gateRight} />
          <span class={capsLook(styles.gateFrameLabel)}>{tryOn.gate.frame}</span>
        </div>
        <p class={styles.gateCaption}>{words.caption}</p>
      </div>
      <form ref={props.form} onSubmit={props.onSubmit} noValidate>
        <Title heading={props.heading}>{words.title}</Title>
        <p class={styles.body}>{words.body}</p>
        <div class={styles.fields}>
          <div>
            <Label htmlFor="gate-name" onInk>
              {tryOn.gate.name}
            </Label>
            <TextInput
              onInk
              id="gate-name"
              value={props.name}
              placeholder={tryOn.gate.namePlaceholder}
              autocomplete="name"
              maxLength={MOST_NAME_LENGTH}
              aria-required="true"
              aria-invalid={nameBad}
              aria-describedby={nameBad ? "gate-name-error" : undefined}
              onInput={(event) => {
                props.onName(event.currentTarget.value);
              }}
            />
            <FieldError id="gate-name-error" text={nameBad ? tryOn.gate.nameError : null} />
          </div>
          <div>
            <Label htmlFor="gate-mobile" onInk>
              {tryOn.gate.mobile}
            </Label>
            <MobileInput
              onInk
              prefix="+91"
              id="gate-mobile"
              value={props.mobile}
              placeholder={tryOn.gate.mobilePlaceholder}
              aria-required="true"
              aria-invalid={mobileBad}
              aria-describedby={mobileBad ? "gate-mobile-error" : undefined}
              onInput={(event) => {
                props.onMobile(formatMobileField(event.currentTarget.value));
              }}
            />
            <FieldError id="gate-mobile-error" text={mobileBad ? tryOn.gate.mobileError : null} />
          </div>
          {code !== null && (
            <NumberCodeField
              idPrefix="gate"
              mobile={props.mobile}
              code={code.value}
              failure={code.failure}
              onInk
              classes={CODE_FIELD}
              onInput={code.onInput}
              onAgain={code.onAgain}
            />
          )}
        </div>
        <div aria-live="polite">
          {props.failure !== null && (
            <div class={messageLook({ tone: "error", ground: "ink", className: styles.gateFailure })}>
              {props.failure}
            </div>
          )}
        </div>
        <Button
          variant="light"
          size="action"
          className={styles.gateSubmit}
          type="submit"
          aria-disabled={busy}
          icon={busy ? ICONS.sending : undefined}
        >
          {submitLabel(code, props.sending)}
        </Button>
        <div class={styles.reassurance}>{words.reassurance}</div>
      </form>
    </div>
  );
}
