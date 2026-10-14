// The login: a number, then its code. Every number gets the
// same second screen, so the app never says whether a number has a booking
// (docs/decisions/0030-one-time-codes.md). The site's booking confirmation
// links here with the number typed there filled in (linked-mobile.ts).
//
// Each step forward is an entry in the browser's history, so a phone's Back
// steps back from the code to the number, as the screen's own back arrow does,
// rather than leaving the app. Signing in goes back past them, so Back
// from Home leaves the app as before.

import { useOtpChallenge } from "@maneman/ui/useOtpChallenge";
import { useEffect, useRef, useState } from "react";
import { api, type LoginChallenge } from "../api.ts";
import { login } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import { titled } from "../lib/arrival.ts";
import { useScreenTitle } from "@maneman/ui/useScreenTitle";
import { apiNow } from "@maneman/web-kit/clock";
import { CodeScreen, type CodeProblem } from "./CodeScreen.tsx";
import { HelpScreen } from "./HelpScreen.tsx";
import { MobileScreen } from "./MobileScreen.tsx";
import { useTurnstile } from "./turnstile.ts";

type Step =
  | { readonly kind: "mobile" }
  | { readonly kind: "code"; readonly challenge: LoginChallenge }
  | { readonly kind: "help"; readonly challenge: LoginChallenge };

const MOBILE_ERRORS: Readonly<Record<string, string>> = login.mobile.errors;

/** Each screen's name in the browser's title: its heading. */
const TITLES = { mobile: login.mobile.title, code: login.code.title, help: login.help.title } as const;

/** Where a step's entry is kept in the history's state, and how many entries above the number each step is. */
const STEP_IN_HISTORY = "loginStep";
const DEPTH: Readonly<Record<Step["kind"], number>> = { mobile: 0, code: 1, help: 2 };

/** The step the history is at: the number unless one of the login's own entries says otherwise. */
function stepInHistory(): Step["kind"] {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return "mobile";
  const kind = (state as Record<string, unknown>)[STEP_IN_HISTORY];
  return kind === "code" || kind === "help" ? kind : "mobile";
}

/** What the code screen says when a code is not sent again: closed, refused for now, or a failure to try again. */
function sendAgainProblem(status: number, code: string): CodeProblem {
  if (status === 410) return { kind: "closed" };
  if (code === "rate_limited") return { kind: "limited" };
  return { kind: "failed" };
}

/** Back through the login's own entries to the number, or to the page the login stood on. */
function rewind(): void {
  const depth = DEPTH[stepInHistory()];
  if (depth > 0) window.history.go(-depth);
}

/**
 * The login's steps, each with its own entry in the history, so Back and Forward move between them; and the last code
 * sent, which a step back and then forward again returns to. A reload loses the code, so the login starts again at
 * the number. Each screen is named, and its heading takes focus unless the screen put it in a field (the code's).
 */
function useSteps() {
  const [step, setStep] = useState<Step>({ kind: "mobile" });
  const lastChallenge = useRef<LoginChallenge | null>(null);

  /** A step forward, with its own entry in the history. */
  const forward = (next: Step) => {
    window.history.pushState({ [STEP_IN_HISTORY]: next.kind }, "");
    setStep(next);
  };

  useEffect(() => {
    if (stepInHistory() !== "mobile") window.history.replaceState(null, "");
    const moved = () => {
      const kind = stepInHistory();
      const challenge = lastChallenge.current;
      setStep(kind === "mobile" || challenge === null ? { kind: "mobile" } : { kind, challenge });
    };
    window.addEventListener("popstate", moved);
    return () => {
      window.removeEventListener("popstate", moved);
    };
  }, []);

  useScreenTitle(titled(TITLES[step.kind]));
  useEffect(() => {
    focusIfLost(document.querySelector("h1"));
  }, [step.kind]);

  return { step, setStep, forward, lastChallenge };
}

/**
 * `ended`: the session ended while the app was open, and the first screen says so. `linkedMobile`: the number the
 * site's booking confirmation opened the app with, or "".
 */
export function Login({
  ended,
  linkedMobile,
  onSignedIn,
}: {
  ended: boolean;
  linkedMobile: string;
  onSignedIn: () => void;
}) {
  const { step, setStep, forward, lastChallenge } = useSteps();
  // The code sent, when, by the API's clock, and one request at a time: a second send bills a second code, voids the
  // first, and takes another from this number's daily ceiling, which can leave a client unable to log in at all.
  const otp = useOtpChallenge<LoginChallenge>(apiNow);
  const { busy, once } = otp;

  const [mobile, setMobile] = useState(linkedMobile);
  // The API's reason no code was sent.
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [problem, setProblem] = useState<CodeProblem | null>(null);
  const turnstile = useTurnstile();

  /** Back to the number, saying why no code was sent. */
  const refused = (code: string) => {
    setMobileError(code in MOBILE_ERRORS ? code : "unknown");
    rewind();
  };

  const send = (digits: string) =>
    once(async () => {
      setMobile(digits);
      const token = await turnstile.token();
      if (token === null) {
        refused("turnstile_failed");
        return;
      }
      const answer = await api.sendCode(digits, token);
      turnstile.renew();
      if (!answer.ok) {
        refused(answer.code);
        return;
      }
      setMobileError(null);
      setProblem(null);
      lastChallenge.current = answer.body;
      otp.sent(answer.body);
      // A fresh code from the code screen stays on it; from the number, the code is a step forward.
      if (stepInHistory() === "mobile") forward({ kind: "code", challenge: answer.body });
      else setStep({ kind: "code", challenge: answer.body });
    });

  const sendAgain = (challenge: LoginChallenge, channel: "whatsapp" | "sms") =>
    once(async () => {
      const answer = await (channel === "sms"
        ? api.smsCode(challenge.challenge_id)
        : api.resendCode(challenge.challenge_id));
      if (answer.ok) {
        setProblem(null);
        lastChallenge.current = answer.body;
        otp.sent(answer.body);
        setStep({ kind: "code", challenge: answer.body });
      } else {
        setProblem(sendAgainProblem(answer.status, answer.code));
      }
    });

  const verify = (challenge: LoginChallenge, code: string) =>
    once(async () => {
      const answer = await api.verify(challenge.challenge_id, code);
      if (!answer.ok) {
        setProblem(answer.status === 410 ? { kind: "closed" } : { kind: "failed" });
      } else if (answer.body.verified) {
        rewind();
        onSignedIn();
      } else {
        setProblem({ kind: "mismatch", left: answer.body.attempts_left });
      }
    });

  if (step.kind === "mobile") {
    return (
      <MobileScreen
        initial={mobile}
        busy={busy}
        error={mobileError}
        ended={ended}
        turnstileBox={turnstile.box}
        onSubmit={(digits) => {
          void send(digits);
        }}
      />
    );
  }
  if (step.kind === "help") {
    return (
      <HelpScreen
        onBack={() => {
          window.history.back();
        }}
      />
    );
  }
  const { challenge } = step;
  return (
    <CodeScreen
      mobile={mobile}
      challenge={challenge}
      sentAt={otp.sentAt}
      busy={busy}
      problem={problem}
      turnstileBox={turnstile.box}
      onVerify={(code) => {
        void verify(challenge, code);
      }}
      onResend={() => {
        void sendAgain(challenge, "whatsapp");
      }}
      onSms={() => {
        void sendAgain(challenge, "sms");
      }}
      onFresh={() => {
        void send(mobile);
      }}
      onBack={() => {
        window.history.back();
      }}
      onHelp={() => {
        forward({ kind: "help", challenge });
      }}
    />
  );
}
