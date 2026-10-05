// The technician's sign-in, from the Prototype's technician screen: the mark,
// the mobile number, the code's six boxes, and one 64 px action at the bottom.
// There is no spec board for it, so the Prototype is the reference.
//
// The Prototype draws both fields at once. The code has to be asked for before
// it can be typed, so the one action is "Send the code" until the backend has
// sent one, and "Sign in" after. The phone names itself on both calls, and
// verifying binds the session to it (docs/decisions/0052-technician-sessions.md).
//
// A wrong code is not an error: the API answers 200 with the tries left, and
// only a closed challenge is refused. The screen follows that, and a closed
// code — refused, or out of tries — takes it back to sending one.
//
// Once a code is out there is always a way on: "Change number" for a number
// typed wrong, and "Send a new code" for one that never came, offered once
// WhatsApp has had time to deliver the first. An installed app has no reload
// button, so a sign-in with no way back would be a dead end.
//
// It also says why it is showing. A phone whose session ended simply signs in
// again; a revoked one is told to ask ops, as is a technician ops switched off,
// with how long his unsent work stays; and a store that has never held a
// session, in an app opened from the home screen, is the iPhone case — the
// installed app has its own cookie jar, so this is a second sign-in on a phone
// already signed in, and saying nothing would read as a lost account.

import { useSecondsLeft } from "@maneman/ui/useSecondsLeft";
import { CodeField } from "@maneman/ui/CodeField";
import { ONE_TIME_CODE } from "../../../../src/policy/one-time-code.ts";
import { Button } from "@maneman/ui/Button";
import { Mark } from "@maneman/ui/Mark";
import { fieldDigits, mobileDigits } from "@maneman/web-kit/mobile";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, type Challenge } from "../api.ts";
import { session, signIn as copy } from "../content.ts";
import { installed } from "../lib/installed.ts";
import type { Out } from "../session.ts";
import { deviceId, enrolled } from "../store/device.ts";
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

/** How long after a code goes out a new one is offered: time enough for WhatsApp to deliver the first. */
const RESEND_AFTER_S = 30;

export function SignIn({ why, onSignedIn }: { why: Out; onSignedIn: () => void }) {
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Left with digits that are not a mobile number: the hint says why Send stays off.
  const [left, setLeft] = useState(false);
  // Counted afresh from each code sent, since each one is a new challenge.
  // When a new code may be asked for: time enough after the last for WhatsApp to deliver it.
  const [resendAt, setResendAt] = useState(0);
  const resendIn = useSecondsLeft(resendAt);
  const number = useRef<HTMLInputElement | null>(null);

  const digits = mobileDigits(mobile);

  async function send(): Promise<void> {
    if (digits === null) {
      setError(copy.mobileError);
      return;
    }
    setWorking(true);
    try {
      const answer = await api.sendCode(digits, await deviceId());
      if (answer.ok) {
        setChallenge(answer.body);
        setResendAt(Date.now() + RESEND_AFTER_S * 1000);
        setCode("");
        setError(null);
      } else setError(messageFor(answer.code, copy.errors.unknown));
    } catch {
      // The phone's store would not give the device ID; the next tap asks it again.
      setError(copy.errors.unknown);
    } finally {
      setWorking(false);
    }
  }

  /** Back to the number, as it was before any code was asked for. */
  function startAgain(): void {
    setChallenge(null);
    setCode("");
  }

  async function verify(): Promise<void> {
    if (challenge === null) return;
    setWorking(true);
    // A phone store that will not give the device ID is a failure to try again, never a button left busy.
    const answer = await deviceId()
      .then((device) => api.verify(challenge.challenge_id, code, device))
      .catch(() => null);
    setWorking(false);
    if (answer === null) {
      setError(copy.errors.unknown);
      return;
    }
    if (!answer.ok) {
      // A closed code cannot be tried again: only a new one can, and none signs in a technician ops stopped.
      if (answer.status === 410 || answer.code === "sign_in_stopped") startAgain();
      setError(messageFor(answer.code, copy.errors.unknown));
      return;
    }
    if (!answer.body.verified && answer.body.attempts_left === 0) {
      startAgain();
      setError(copy.errors.code_expired);
      return;
    }
    if (!answer.body.verified) {
      setCode("");
      setError(copy.attemptsLeft(answer.body.attempts_left));
      return;
    }
    // The session cookie is set; who is signed in comes from GET /tech/me, which App asks next
    // and records the enrolment again, so a phone too full to record it here still signs in.
    await enrolled().catch(() => undefined);
    onSignedIn();
  }

  const ready = challenge === null ? digits !== null : code.length === ONE_TIME_CODE.digits;
  // Only worth saying before the code has been asked for, and only in the app
  // that caused it: a first sign-in in a browser needs no explanation.
  const quiet = challenge === null && error === null;
  const note = noteFor(why);
  const hint = left && challenge === null && mobile !== "" && digits === null ? copy.mobileError : null;
  const shown = error ?? hint;

  return (
    <main className={styles.screen}>
      <Mark className={styles.mark} />
      <h1 className={styles.title}>{copy.title}</h1>

      <div className={styles.mobile}>
        <span className={styles.prefix}>{copy.prefix}</span>
        <input
          ref={number}
          className={styles.number}
          value={mobile}
          onChange={(event) => {
            setMobile(fieldDigits(event.target.value));
            setError(null);
            setLeft(false);
          }}
          onBlur={() => {
            setLeft(true);
          }}
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={copy.mobilePlaceholder}
          aria-label={copy.mobileLabel}
          disabled={challenge !== null}
        />
      </div>

      <div className={styles.codeBlock}>
        <div className={styles.label}>{copy.codeLabel}</div>
        <CodeField
          className={styles.code}
          value={code}
          label={copy.codeLabel}
          disabled={challenge === null}
          onChange={setCode}
        />
      </div>

      {challenge !== null && (
        <div className={styles.again}>
          <Button
            variant="outlineOnInk"
            size="small"
            className={styles.againButton}
            onClick={() => {
              // Drawn at once, so the number is editable before it is focused.
              flushSync(() => {
                startAgain();
                setError(null);
              });
              number.current?.focus();
            }}
          >
            {copy.changeNumber}
          </Button>
          <Button
            variant="outlineOnInk"
            size="small"
            className={styles.againButton}
            disabled={resendIn > 0 || working}
            onClick={() => void send()}
          >
            {resendIn > 0 ? copy.resendIn(resendIn) : copy.resend}
          </Button>
        </div>
      )}

      {challenge !== null && error === null && <p className={styles.note}>{copy.codeSent}</p>}
      {quiet && hint === null && note !== null && <p className={styles.note}>{note}</p>}
      {shown !== null && (
        <p className={styles.error} role="alert">
          {shown}
        </p>
      )}

      <div className={styles.foot}>
        <Button
          variant="gold"
          size="action"
          className={styles.action}
          disabled={!ready || working}
          busy={working}
          onClick={() => void (challenge === null ? send() : verify())}
        >
          {challenge === null ? copy.sendCode : copy.submit}
        </Button>
      </div>
    </main>
  );
}
