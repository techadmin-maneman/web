// The login (boards A1 to A3): a number, then its code. Every number gets the
// same second screen, so the app never says whether a number has a booking
// (docs/decisions/0030-one-time-codes.md).

import { useState } from "react";
import { api, type LoginChallenge } from "../api.ts";
import { login } from "../content.ts";
import { CodeScreen, type CodeProblem } from "./CodeScreen.tsx";
import { HelpScreen } from "./HelpScreen.tsx";
import { MobileScreen } from "./MobileScreen.tsx";

type Step =
  | { readonly kind: "mobile" }
  | { readonly kind: "code"; readonly challenge: LoginChallenge }
  | { readonly kind: "help"; readonly challenge: LoginChallenge };

const MOBILE_ERRORS: Readonly<Record<string, string>> = login.mobile.errors;

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "mobile" });
  const [mobile, setMobile] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [problem, setProblem] = useState<CodeProblem | null>(null);

  async function send(digits: string) {
    setBusy(true);
    setMobile(digits);
    const answer = await api.sendCode(digits);
    setBusy(false);
    if (!answer.ok) {
      setMobileError(MOBILE_ERRORS[answer.code] ?? login.mobile.errors.unknown);
      setStep({ kind: "mobile" });
      return;
    }
    setMobileError(null);
    setProblem(null);
    setStep({ kind: "code", challenge: answer.body });
  }

  async function sendAgain(challenge: LoginChallenge, channel: "whatsapp" | "sms") {
    setBusy(true);
    const answer = await (channel === "sms"
      ? api.smsCode(challenge.challenge_id)
      : api.resendCode(challenge.challenge_id));
    setBusy(false);
    if (answer.ok) {
      setProblem(null);
      setStep({ kind: "code", challenge: answer.body });
    } else {
      setProblem(answer.status === 410 ? { kind: "closed" } : { kind: "failed" });
    }
  }

  async function verify(challenge: LoginChallenge, code: string) {
    setBusy(true);
    const answer = await api.verify(challenge.challenge_id, code);
    setBusy(false);
    if (!answer.ok) {
      setProblem(answer.status === 410 ? { kind: "closed" } : { kind: "failed" });
    } else if (answer.body.verified) {
      onSignedIn();
    } else {
      setProblem({ kind: "mismatch", left: answer.body.attempts_left });
    }
  }

  if (step.kind === "mobile") {
    return (
      <MobileScreen
        initial={mobile}
        busy={busy}
        error={mobileError}
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
