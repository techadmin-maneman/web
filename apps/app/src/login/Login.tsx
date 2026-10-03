// The login (boards A1 to A3): a number, then its code. Every number gets the
// same second screen, so the app never says whether a number has a booking
// (docs/decisions/0030-one-time-codes.md). The site's booking confirmation
// links here with the number typed there filled in (linked-mobile.ts).
//
// Each step forward is an entry in the browser's history, so a phone's Back
// steps back from the code to the number, as the screen's own back arrow does,
// rather than leaving the app (CLI-27). Signing in goes back past them, so Back
// from Home leaves the app as before.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useRef, useState } from "react";
import { api, type LoginChallenge } from "../api.ts";
import { login } from "../content.ts";
import { focusIfLost, nameInTitle } from "../lib/arrival.ts";
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
  const [step, setStep] = useState<Step>({ kind: "mobile" });
  // The last code sent, which a step back and then forward again returns to.
  const lastChallenge = useRef<LoginChallenge | null>(null);

  /** A step forward, with its own entry in the history. */
  const forward = (next: Step) => {
    window.history.pushState({ [STEP_IN_HISTORY]: next.kind }, "");
    setStep(next);
  };

  // Back and Forward move between the steps. A reload loses the code, so the login starts again at the number.
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

  // Each screen is named, and its heading takes focus unless the screen put it in a field (the code's).
  useEffect(() => {
    nameInTitle(TITLES[step.kind]);
    focusIfLost(document.querySelector("h1"));
  }, [step.kind]);
  const [mobile, setMobile] = useState(linkedMobile);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [problem, setProblem] = useState<CodeProblem | null>(null);
  // One code at a time: a second send bills a second code, voids the first, and takes another
  // from this number's daily ceiling, which can leave a client unable to log in at all.
  const [busy, once] = useOneAtATime();
  const turnstile = useTurnstile();

  /** Back to the number, saying why no code was sent. */
  const refused = (code: string) => {
    setMobileError(MOBILE_ERRORS[code] ?? login.mobile.errors.unknown);
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
