// A2: the code (design/phase2/Client App, board A2).

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LoginChallenge } from "../api.ts";
import { login } from "../content.ts";
import { BUBBLE } from "../icons.ts";
import { apiNow } from "../lib/clock.ts";
import { useSecondsLeft } from "../lib/useSecondsLeft.ts";
import { CodeField } from "./CodeField.tsx";
import styles from "./login.module.css";
import { masked } from "./mobile.ts";

export type CodeProblem =
  { readonly kind: "mismatch"; readonly left: number } | { readonly kind: "closed" } | { readonly kind: "failed" };

interface Props {
  readonly mobile: string;
  readonly challenge: LoginChallenge;
  readonly busy: boolean;
  readonly problem: CodeProblem | null;
  readonly onVerify: (code: string) => void;
  readonly onResend: () => void;
  readonly onSms: () => void;
  readonly onFresh: () => void;
  readonly onBack: () => void;
  readonly onHelp: () => void;
}

/** Asks the browser for the code in the SMS, where it can read one (WebOTP; Chrome on Android). */
function useSmsCode(active: boolean, onCode: (code: string) => void): void {
  useEffect(() => {
    if (!active || !("OTPCredential" in window)) return;
    const controller = new AbortController();
    const get = navigator.credentials.get.bind(navigator.credentials) as (
      options: unknown,
    ) => Promise<{ code?: string } | null>;
    get({ otp: { transport: ["sms"] }, signal: controller.signal })
      .then((credential) => {
        if (typeof credential?.code === "string") onCode(credential.code);
      })
      .catch(() => undefined); // declined, aborted or unsupported: the client types it instead
    return () => {
      controller.abort();
    };
  }, [active, onCode]);
}

export function CodeScreen(props: Props) {
  const copy = login.code;
  const { challenge, problem } = props;
  const [code, setCode] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // Counted from when this code was sent: a new code, a new count.
  const resendAt = useMemo(() => apiNow() + challenge.resend_in_s * 1000, [challenge]);
  const smsAt = useMemo(() => apiNow() + (challenge.sms_in_s ?? 0) * 1000, [challenge]);
  const resendIn = useSecondsLeft(resendAt);
  const smsIn = useSecondsLeft(smsAt);
  const closed = problem?.kind === "closed" || (problem?.kind === "mismatch" && problem.left === 0);
  useSmsCode(challenge.channel === "sms", setCode);

  useEffect(() => {
    setCode("");
  }, [challenge]);

  // After a wrong code, focus goes back to the field for the next try: the tap on Continue left it on nothing.
  useEffect(() => {
    if (problem !== null) field.current?.focus();
  }, [problem]);

  const message =
    problem === null
      ? null
      : problem.kind === "mismatch"
        ? copy.mismatch(problem.left)
        : problem.kind === "closed"
          ? copy.expired
          : copy.failed;
  const sent = challenge.channel === "sms" ? copy.sentSms : copy.sentWhatsapp;
  const offerSms = challenge.sms_in_s !== null && smsIn === 0 && challenge.channel !== "sms" && !closed;

  return (
    <main className={styles.screen}>
      <div className={styles.top}>
        <button className={styles.back} type="button" onClick={props.onBack} aria-label={copy.back}>
          <Icon d={ICONS.back} size={22} />
        </button>
      </div>
      <form
        className={`${styles.body} ${styles.form}`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === 6 && !closed) props.onVerify(code);
        }}
      >
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.lead}>{sent(masked(props.mobile))}</p>
        <CodeField ref={field} value={code} label={copy.label} invalid={problem !== null} onChange={setCode} />
        {message !== null && (
          // Busy while a code is on its way, so a screen reader is told the screen is working
          // rather than re-reading the problem the client has already acted on.
          <p className={styles.error} role="alert" aria-busy={props.busy}>
            {message}
          </p>
        )}
        {challenge.channel === "sms" && (
          <div className={styles.automatic}>
            <Icon d={BUBBLE} size={17} />
            {copy.automatic}
          </div>
        )}
        <div className={styles.links}>
          {offerSms && (
            <button className={styles.link} type="button" onClick={props.onSms} disabled={props.busy}>
              <span>{copy.sms}</span>
            </button>
          )}
          {closed ? (
            <button className={styles.link} type="button" onClick={props.onFresh} disabled={props.busy}>
              <span>{copy.fresh}</span>
            </button>
          ) : resendIn > 0 ? (
            // Shown, not spoken: a screen reader is not told every second.
            <p className={styles.countdown} aria-live="off">
              {copy.resendIn} {resendIn}s
            </p>
          ) : (
            <button className={styles.link} type="button" onClick={props.onResend} disabled={props.busy}>
              <span>{copy.resend}</span>
            </button>
          )}
          <button className={styles.link} type="button" onClick={props.onHelp}>
            <span>{copy.noBooking}</span>
          </button>
        </div>
        {/* Said once, as the countdown runs out; the count itself is shown and not spoken. */}
        <VisuallyHidden as="p" role="status">
          {resendIn === 0 && !closed ? copy.canResend : ""}
        </VisuallyHidden>
        <div className={styles.foot}>
          <button className={styles.primary} type="submit" disabled={code.length < 6 || props.busy || closed}>
            {copy.submit}
          </button>
        </div>
      </form>
    </main>
  );
}
