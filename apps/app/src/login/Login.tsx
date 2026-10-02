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
import { carriesMobile, mobileInLink } from "./linked-mobile.ts";
import { MobileScreen } from "./MobileScreen.tsx";

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

/** Back through the login's own entries to the number, or to the page the login stood on. */
function rewind(): void {
  const depth = DEPTH[stepInHistory()];
  if (depth > 0) window.history.go(-depth);
}

/** `ended`: the session ended while the app was open, and the first screen says so. */
export function Login({ ended, onSignedIn }: { ended: boolean; onSignedIn: () => void }) {
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
  const [mobile, setMobile] = useState(() => mobileInLink(window.location.hash));
  // The number is not left in the browser's history.
  useEffect(() => {
    if (!carriesMobile(window.location.hash)) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, []);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [problem, setProblem] = useState<CodeProblem | null>(null);
  // One code at a time: a second send bills a second code, voids the first, and takes another
  // from this number's daily ceiling, which can leave a client unable to log in at all.
  const [busy, once] = useOneAtATime();

  const send = (digits: string) =>
    once(async () => {
      setMobile(digits);
      const answer = await api.sendCode(digits);
      if (!answer.ok) {
        setMobileError(MOBILE_ERRORS[answer.code] ?? login.mobile.errors.unknown);
        rewind();
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
        setProblem(answer.status === 410 ? { kind: "closed" } : { kind: "failed" });
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
