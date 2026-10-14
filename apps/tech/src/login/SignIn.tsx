// The technician's sign-in, from the Prototype's technician screen: the number, then the code, the session bound to
// this phone (docs/decisions/0052-technician-sessions.md). Once a code is out there is always a way on, since an
// installed app has no reload, and the screen says why it is showing: ended, revoked, switched off, or an iPhone's
// second sign-in.

import { useOtpChallenge } from "@maneman/ui/useOtpChallenge";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Field } from "@maneman/ui/Field";
import { MobileInput } from "@maneman/ui/MobileInput";
import { CodeField } from "@maneman/ui/CodeField";
import { ONE_TIME_CODE } from "@rules/policy/one-time-code.ts";
import { Button } from "@maneman/ui/Button";
import { Mark } from "@maneman/ui/Mark";
import { fieldDigits, mobileDigits } from "@maneman/web-kit/mobile";
import { apiNow } from "@maneman/web-kit/clock";
import { useEffect, useRef, useState, type Ref } from "react";
import { flushSync } from "react-dom";
import { api, type Challenge } from "../api.ts";
import { session, signIn as copy } from "../content.ts";
import { installed } from "../lib/installed.ts";
import type { Out } from "../session.ts";
import { deviceId, enrolled } from "../store/device.ts";
import frame from "../components/frame.module.css";
import styles from "./login.module.css";

/** What the sign-in says before the code is asked for: what ops did, or why an installed app is out. */
function noteFor(why: Out): string | null {
  if (why === "revoked") return session.revoked;
  if (why === "switched-off") return session.switchedOff;
  if (why === "work-kept") return session.workKept;
  return why === "fresh" && installed() ? copy.installed : null;
}

/** The API's error code in the app's words, or the line that fits when the code is one we do not know. */
const MESSAGES: Readonly<Record<string, string>> = copy.errors;
const messageFor = (code: string, fallback: string) => MESSAGES[code] ?? fallback;

/** What a check of the code came to: signed in, or the line to show, whether a new code is needed, or the code was wrong. */
type Verdict =
  | { readonly signedIn: true }
  | { readonly signedIn: false; readonly error: string; readonly again: boolean; readonly wrong: boolean };

function verdictOf(answer: Awaited<ReturnType<typeof api.verify>> | null): Verdict {
  if (answer === null) return { signedIn: false, error: copy.errors.unknown, again: false, wrong: false };
  if (!answer.ok) {
    // A closed code cannot be tried again: only a new one can, and none signs in a technician ops stopped.
    const closed = answer.status === 410 || answer.code === "sign_in_stopped";
    return { signedIn: false, error: messageFor(answer.code, copy.errors.unknown), again: closed, wrong: false };
  }
  if (answer.body.verified) return { signedIn: true };
  if (answer.body.attempts_left === 0) {
    return { signedIn: false, error: copy.errors.code_expired, again: true, wrong: false };
  }
  return { signedIn: false, error: copy.attemptsLeft(answer.body.attempts_left), again: false, wrong: true };
}

/** Once a code is out, the ways on: a number typed wrong, or a code that never came, once WhatsApp has had time. */
function Again(props: { resendIn: number; busy: boolean; onChangeNumber: () => void; onResend: () => void }) {
  return (
    <div className={styles.again}>
      <Button variant="outlineOnInk" size="small" className={styles.againButton} onClick={props.onChangeNumber}>
        {copy.changeNumber}
      </Button>
      <Button
        variant="outlineOnInk"
        size="small"
        className={styles.againButton}
        disabled={props.resendIn > 0 || props.busy}
        onClick={props.onResend}
      >
        {props.resendIn > 0 ? copy.resendIn(props.resendIn) : copy.resend}
      </Button>
    </div>
  );
}

/** The code's six boxes, open once a code is out; the sixth digit sends it. */
function CodeStep(props: {
  boxes: Ref<HTMLInputElement>;
  code: string;
  open: boolean;
  onCode: (code: string) => void;
  onComplete: (code: string) => void;
}) {
  return (
    <div className={styles.codeBlock}>
      <div className={styles.label}>{copy.codeLabel}</div>
      <CodeField
        ref={props.boxes}
        className={styles.code}
        value={props.code}
        label={copy.codeLabel}
        disabled={!props.open}
        onChange={props.onCode}
        onComplete={props.onComplete}
      />
    </div>
  );
}

export function SignIn({ why, onSignedIn }: { why: Out; onSignedIn: () => void }) {
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The code sent, and when a new one may be asked for: time enough after the last for WhatsApp to deliver it.
  const otp = useOtpChallenge<Challenge>(apiNow);
  const { challenge, resendIn, busy: working, once } = otp;
  // Left with digits that are not a mobile number: the hint says why Send stays off.
  const [left, setLeft] = useState(false);
  const number = useRef<HTMLInputElement | null>(null);
  const codeBoxes = useRef<HTMLInputElement | null>(null);

  // Once a code is out, the keyboard opens on its boxes: a gloved technician need not tap into them.
  useEffect(() => {
    if (challenge !== null) codeBoxes.current?.focus();
  }, [challenge]);

  const digits = mobileDigits(mobile);

  async function sendOnce(): Promise<void> {
    if (digits === null) {
      setError(copy.mobileError);
      return;
    }
    try {
      const answer = await api.sendCode(digits, await deviceId());
      if (answer.ok) {
        otp.sent(answer.body);
        setCode("");
        setError(null);
      } else setError(messageFor(answer.code, copy.errors.unknown));
    } catch {
      // The phone's store would not give the device ID; the next tap asks it again.
      setError(copy.errors.unknown);
    }
  }
  const send = () => once(sendOnce);

  /** Back to the number, as it was before any code was asked for. */
  function startAgain(): void {
    otp.forget();
    setCode("");
  }

  async function verifyOnce(typed: string): Promise<void> {
    if (challenge === null) return;
    // A phone store that will not give the device ID is a failure to try again, never a button left busy.
    const answer = await deviceId()
      .then((device) => api.verify(challenge.challenge_id, typed, device))
      .catch(() => null);
    const verdict = verdictOf(answer);
    if (verdict.signedIn) {
      // The session cookie is set; who is signed in comes from GET /tech/me, which App asks next
      // and records the enrolment again, so a phone too full to record it here still signs in.
      await enrolled().catch(() => undefined);
      onSignedIn();
      return;
    }
    if (verdict.again) startAgain();
    else if (verdict.wrong) setCode("");
    setError(verdict.error);
  }
  const verify = (typed: string = code) => once(() => verifyOnce(typed));

  const ready = challenge === null ? digits !== null : code.length === ONE_TIME_CODE.digits;
  // Only worth saying before the code has been asked for, and only in the app
  // that caused it: a first sign-in in a browser needs no explanation.
  const quiet = challenge === null && error === null;
  const note = noteFor(why);
  const hint = left && challenge === null && mobile !== "" && digits === null ? copy.mobileError : null;
  const shown = error ?? hint;

  return (
    <form
      className={styles.screen}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !working) void (challenge === null ? send() : verify());
      }}
    >
      <Mark className={styles.mark} />
      <h1 className={styles.title}>{copy.title}</h1>

      <Field onInk labelHidden label={copy.mobileLabel}>
        {(control) => (
          <MobileInput
            {...control}
            onInk
            ref={number}
            className={styles.mobile}
            prefix={copy.prefix}
            value={mobile}
            onChange={(event) => {
              setMobile(fieldDigits(event.target.value));
              setError(null);
              setLeft(false);
            }}
            onBlur={() => {
              setLeft(true);
            }}
            placeholder={copy.mobilePlaceholder}
            disabled={challenge !== null}
          />
        )}
      </Field>

      <CodeStep
        boxes={codeBoxes}
        code={code}
        open={challenge !== null}
        onCode={setCode}
        onComplete={(typed) => {
          if (!working) void verify(typed);
        }}
      />

      {challenge !== null && (
        <Again
          resendIn={resendIn}
          busy={working}
          onChangeNumber={() => {
            // Drawn at once, so the number is editable before it is focused.
            flushSync(() => {
              startAgain();
              setError(null);
            });
            number.current?.focus();
          }}
          onResend={() => void send()}
        />
      )}

      {challenge !== null && error === null && <p className={styles.note}>{copy.codeSent}</p>}
      {quiet && hint === null && note !== null && <p className={styles.note}>{note}</p>}
      {shown !== null && (
        <InlineMessage tone="error" ground="ink" className={styles.error}>
          {shown}
        </InlineMessage>
      )}

      <div className={styles.foot}>
        <Button
          variant="gold"
          size="action"
          type="submit"
          className={frame.action}
          disabled={!ready || working}
          busy={working}
        >
          {challenge === null ? copy.sendCode : copy.submit}
        </Button>
      </div>
    </form>
  );
}
