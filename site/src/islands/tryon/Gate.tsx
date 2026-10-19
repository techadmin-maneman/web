import { capsLook } from "@maneman/ui/Caps";
import { messageLook } from "@maneman/ui/InlineMessage";
import { Button } from "@maneman/ui/Button";
import { ICONS } from "@maneman/brand/icons";
import { NoticeLine } from "@maneman/ui/NoticeLine";
import { CLIENT_WORDS } from "@maneman/web-kit/client-words";
import { numberCode as numberCodeWords, tryOn, type Notice } from "../../content/site.ts";
import { NumberCodeField, type CodeFieldClasses } from "../NumberCodeField.tsx";
import { MobileField, NameField } from "../PersonFields.tsx";
import type { FormRef } from "../useInvalidFocus.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./gate.module.css";

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

/** What the gate says as it sends: that the photograph is still on its way, or why the look did not go. */
function GateSaid({ photoOnItsWay, failure }: { photoOnItsWay: boolean; failure: string | null }) {
  return (
    <div aria-live="polite">
      {photoOnItsWay && <p class={styles.reassurance}>{tryOn.gate.photoOnItsWay}</p>}
      {failure !== null && (
        <div class={messageLook({ tone: "error", ground: "ink", className: styles.gateFailure })}>{failure}</div>
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
  /** The photograph is still uploading, and the look waits for it. */
  photoOnItsWay: boolean;
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
  return (
    <div class={styles.gate}>
      <div class={styles.gateImage}>
        <div class={styles.gateFrame}>
          <div class={styles.gateLeft} />
          <div class={styles.gateRight} />
          <span class={capsLook(styles.gateFrameLabel)}>{tryOn.gate.frame}</span>
        </div>
        <p class={styles.gateCaption}>{tryOn.gate.caption}</p>
      </div>
      <form ref={props.form} onSubmit={props.onSubmit} noValidate>
        <Title heading={props.heading}>{tryOn.gate.title}</Title>
        <div class={styles.fields}>
          <NameField id="gate-name" value={props.name} bad={nameBad} words={tryOn.gate} onInk onInput={props.onName} />
          <MobileField
            id="gate-mobile"
            value={props.mobile}
            bad={mobileBad}
            words={tryOn.gate}
            onInk
            onInput={props.onMobile}
          />
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
        <GateSaid photoOnItsWay={props.photoOnItsWay} failure={props.failure} />
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
        {props.notice.line !== undefined && (
          <p class={styles.reassurance}>
            <NoticeLine
              line={props.notice.line}
              href={props.notice.line.href}
              more={CLIENT_WORDS.noticeMore}
              tone="ink"
            />
          </p>
        )}
      </form>
    </div>
  );
}
