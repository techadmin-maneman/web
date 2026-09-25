// The login (boards A1 to A3): a number, then its code. Every number gets the
// same second screen, so the app never says whether a number has a booking
// (docs/decisions/0030-one-time-codes.md).

import { useEffect, useState } from "react";
import { api, type LoginChallenge } from "../api.ts";
import { login } from "../content.ts";
import { focusIfLost, nameInTitle } from "../lib/arrival.ts";
import { useOneAtATime } from "../lib/useOneAtATime.ts";
import { CodeScreen, type CodeProblem } from "./CodeScreen.tsx";
import { HelpScreen } from "./HelpScreen.tsx";
import { MobileScreen } from "./MobileScreen.tsx";

type Step =
  | { readonly kind: "mobile" }
  | { readonly kind: "code"; readonly challenge: LoginChallenge }
  | { readonly kind: "help"; readonly challenge: LoginChallenge };

const MOBILE_ERRORS: Readonly<Record<string, string>> = login.mobile.errors;

/** Each screen's name in the browser's title: its heading. */
const TITLES = { mobile: login.mobile.title, code: login.code.title, help: login.help.title } as const;

/** `ended`: the session ended while the app was open, and the first screen says so. */
export function Login({ ended, onSignedIn }: { ended: boolean; onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "mobile" });

  // Each screen is named, and its heading takes focus unless the screen put it in a field (the code's).
  useEffect(() => {
    nameInTitle(TITLES[step.kind]);
    focusIfLost(document.querySelector("h1"));
  }, [step.kind]);
  const [mobile, setMobile] = useState("");
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
        setStep({ kind: "mobile" });
        return;
      }
      setMobileError(null);
      setProblem(null);
      setStep({ kind: "code", challenge: answer.body });
    });

  const sendAgain = (challenge: LoginChallenge, channel: "whatsapp" | "sms") =>
    once(async () => {
      const answer = await (channel === "sms"
        ? api.smsCode(challenge.challenge_id)
        : api.resendCode(challenge.challenge_id));
      if (answer.ok) {
        setProblem(null);
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
          setStep({ kind: "code", challenge: step.challenge });
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
        setStep({ kind: "mobile" });
      }}
      onHelp={() => {
        setStep({ kind: "help", challenge });
      }}
    />
  );
}
