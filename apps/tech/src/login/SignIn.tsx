// The technician's sign-in, from the Prototype's technician screen: the mark,
// the mobile number, the code's six boxes, and one 64 px action at the bottom.
// There is no spec board for it, so the Prototype is the reference.
//
// The Prototype draws both fields at once. The code has to be asked for before
// it can be typed, so the one action is "Send the code" until the backend has
// sent one, and "Sign in" after. Verifying enrols this device, and the session
// is bound to it (docs/decisions/0029-sessions.md).

import { useState } from "react";
import { api, type Challenge } from "../api.ts";
import { Mark } from "../components/Mark.tsx";
import { session, signIn as copy } from "../content.ts";
import { deviceId, enrolled, keepMe } from "../store/device.ts";
import styles from "./login.module.css";

/** The API's error code in the app's words, or the line that fits when the code is one we do not know. */
const MESSAGES: Readonly<Record<string, string>> = copy.errors;
const messageFor = (code: string, fallback: string) => MESSAGES[code] ?? fallback;

/** The code's six boxes, as one labelled field: assistive technology sees a single input. */
function CodeBoxes({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <div className={styles.boxes}>
      <input
        className={styles.hiddenInput}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value.replace(/\D/g, "").slice(0, 6));
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        aria-label={copy.codeLabel}
      />
      <div className={styles.boxRow} aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className={styles.box}>
            {value[index] ?? null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SignIn({ revoked, onSignedIn }: { revoked: boolean; onSignedIn: () => void }) {
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const tenDigits = /^\d{10}$/.test(mobile);

  async function send(): Promise<void> {
    if (!tenDigits) {
      setError(copy.mobileError);
      return;
    }
    setWorking(true);
    const answer = await api.sendCode(mobile);
    setWorking(false);
    if (answer.ok) {
      setChallenge(answer.body);
      setError(null);
    } else setError(messageFor(answer.code, copy.errors.unknown));
  }

  async function verify(): Promise<void> {
    if (challenge === null) return;
    setWorking(true);
    const answer = await api.verify(challenge.challenge_id, code, await deviceId());
    setWorking(false);
    if (answer.ok) {
      await keepMe(answer.body);
      await enrolled();
      onSignedIn();
    } else setError(messageFor(answer.code, copy.errors.mismatch));
  }

  const ready = challenge === null ? tenDigits : code.length === 6;

  return (
    <main className={styles.screen}>
      <Mark className={styles.mark} />
      <h1 className={styles.title}>{copy.title}</h1>

      <div className={styles.mobile}>
        <span className={styles.prefix}>{copy.prefix}</span>
        <input
          className={styles.number}
          value={mobile}
          onChange={(event) => {
            setMobile(event.target.value.replace(/\D/g, "").slice(0, 10));
            setError(null);
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
        <CodeBoxes value={code} disabled={challenge === null} onChange={setCode} />
      </div>

      {challenge !== null && error === null && <p className={styles.note}>{copy.codeSent}</p>}
      {revoked && challenge === null && error === null && <p className={styles.note}>{session.revoked}</p>}
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.foot}>
        <button
          className={styles.action}
          type="button"
          disabled={!ready || working}
          onClick={() => void (challenge === null ? send() : verify())}
        >
          {challenge === null ? copy.sendCode : copy.submit}
        </button>
      </div>
    </main>
  );
}
