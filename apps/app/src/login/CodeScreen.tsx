// A2: the code (design/phase2/Client App, board A2).

import { ONE_TIME_CODE } from "../../../../src/policy/one-time-code.ts";
import { classes } from "@maneman/ui/classes";
import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useEffect, useRef, useState, type RefCallback } from "react";
import type { LoginChallenge } from "../api.ts";
import { login } from "../content.ts";
import { BUBBLE } from "../icons.ts";
import { useSecondsLeft } from "../lib/useSecondsLeft.ts";
import { CodeField } from "./CodeField.tsx";
import styles from "./login.module.css";
import { MessageUs } from "./MessageUs.tsx";
import { masked } from "./mobile.ts";

export type CodeProblem =
  | { readonly kind: "mismatch"; readonly left: number }
  | { readonly kind: "closed" }
  | { readonly kind: "failed" }
  | { readonly kind: "limited" };

interface Props {
  readonly mobile: string;
  readonly challenge: LoginChallenge;
  /** When the code was sent, by the API's clock. */
  readonly sentAt: number;
  readonly busy: boolean;
  readonly problem: CodeProblem | null;
  /** Where Turnstile renders while a new code is offered, which needs its check. */
  readonly turnstileBox: RefCallback<HTMLDivElement>;
  readonly onVerify: (code: string) => void;
  readonly onResend: () => void;
  readonly onSms: () => void;
  readonly onFresh: () => void;
  readonly onBack: () => void;
  readonly onHelp: () => void;
}

/** What went wrong with the last code, in board A2's words; nothing while nothing has. */
function problemLine(problem: CodeProblem | null): string | null {
  if (problem === null) return null;
  if (problem.kind === "mismatch") return login.code.mismatch(problem.left);
  if (problem.kind === "limited") return login.code.limited;
  return problem.kind === "closed" ? login.code.expired : login.code.failed;
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

/** The way to another code: a fresh one once this is closed, else a resend, counted down until it is offered. */
function Another(props: {
  closed: boolean;
  resendIn: number;
  busy: boolean;
  onFresh: () => void;
  onResend: () => void;
}) {
  const copy = login.code;
  if (props.closed) {
    return (
      <button className={styles.link} type="button" onClick={props.onFresh} disabled={props.busy}>
        <span>{copy.fresh}</span>
      </button>
    );
  }
  if (props.resendIn > 0) {
    // Shown, not spoken: a screen reader is not told every second.
    return (
      <p className={styles.countdown} aria-live="off">
        {copy.resendIn} {props.resendIn}s
      </p>
    );
  }
  return (
    <button className={styles.link} type="button" onClick={props.onResend} disabled={props.busy}>
      <span>{copy.resend}</span>
    </button>
  );
}

export function CodeScreen(props: Props) {
  const copy = login.code;
  const { challenge, problem } = props;
  const [code, setCode] = useState("");
  // The problem the client has typed since: its line goes, unless the code is closed and typing cannot help.
  const [typedSince, setTypedSince] = useState<CodeProblem | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // Counted from when this code was sent, so the help screen and back do not start the count again.
  const resendAt = props.sentAt + challenge.resend_in_s * 1000;
  const smsAt = props.sentAt + (challenge.sms_in_s ?? 0) * 1000;
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

  const message = problem !== null && problem === typedSince && !closed ? null : problemLine(problem);
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
        className={classes(styles.body, styles.form)}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === ONE_TIME_CODE.digits && !closed) props.onVerify(code);
        }}
      >
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.lead}>{sent(masked(props.mobile))}</p>
        <CodeField
          ref={field}
          value={code}
          label={copy.label}
          invalid={message !== null}
          onChange={(typed) => {
            setCode(typed);
            setTypedSince(problem);
          }}
        />
        {message !== null && (
          // Busy while a code is on its way, so a screen reader is told the screen is working
          // rather than re-reading the problem the client has already acted on.
          <p className={styles.error} role="alert" aria-busy={props.busy}>
            {message}
          </p>
        )}
        {message !== null && problem?.kind === "limited" && <MessageUs />}
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
          <Another
            closed={closed}
            resendIn={resendIn}
            busy={props.busy}
            onFresh={props.onFresh}
            onResend={props.onResend}
          />
          <button className={styles.link} type="button" onClick={props.onHelp}>
            <span>{copy.noBooking}</span>
          </button>
        </div>
        {closed && <div ref={props.turnstileBox} className={styles.turnstile} />}
        {/* Said once, as the countdown runs out; the count itself is shown and not spoken. */}
        <VisuallyHidden as="p" role="status">
          {resendIn === 0 && !closed ? copy.canResend : ""}
        </VisuallyHidden>
        <div className={styles.foot}>
          <Button
            variant="light"
            size="action"
            className={styles.primary}
            type="submit"
            disabled={code.length < ONE_TIME_CODE.digits || props.busy || closed}
            busy={props.busy}
          >
            {copy.submit}
          </Button>
        </div>
      </form>
    </main>
  );
}
