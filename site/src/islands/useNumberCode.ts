// The WhatsApp code that proves the number typed, before /book's consultation and fit in one visit or /try's gate
// acts on it. A form asks for the code once its fields are complete, shows the code's field, and once the code is
// entered sends what it acts on with the code's ID. A code is for the number it was sent to: another number needs
// its own.

import { useState } from "preact/hooks";
import { numberCode as words } from "../content/site.ts";
import { askForNumberCode, verifyNumberCode, type Answer, type NumberCode, type NumberCodeVerify } from "../lib/api.ts";

/** The code sent, to the ten digits it went to, and whether it has been entered. */
interface Sent {
  readonly digits: string;
  readonly codeId: string;
  readonly proved: boolean;
}

const SIX_DIGITS = /^\d{6}$/;

/** The line beneath the code's field for an answer that did not prove the number. */
function failureOf(answer: Answer<NumberCodeVerify>): string {
  if (!answer.ok) return answer.code === "code_expired" ? words.expired : words.failed;
  if (answer.body.verified) return "";
  const left = answer.body.attempts_left;
  return left === 0 ? words.expired : words.wrong(left);
}

export function useNumberCode() {
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** The code's ID once it has proved these digits; null until then. */
  function proofFor(digits: string): string | null {
    if (sent === null || !sent.proved || sent.digits !== digits) return null;
    return sent.codeId;
  }

  /** Whether a code went to these digits and waits to be entered. */
  function waitingFor(digits: string): boolean {
    return sent !== null && !sent.proved && sent.digits === digits;
  }

  /** Asks for a code to these digits, with the name typed beside them. */
  async function ask(digits: string, name: string, turnstileToken: string): Promise<Answer<NumberCode>> {
    const answer = await askForNumberCode({ mobile: digits, name, turnstile_token: turnstileToken });
    if (answer.ok) {
      setSent({ digits, codeId: answer.body.code_id, proved: false });
      setCode("");
      setFailure(null);
    }
    return answer;
  }

  /** Checks the code typed: the code's ID once it proves the number, otherwise null and why beneath the field. */
  async function confirm(): Promise<string | null> {
    if (sent === null || checking) return null;
    const typed = code.replace(/\D/g, "");
    if (!SIX_DIGITS.test(typed)) {
      setFailure(words.incomplete);
      return null;
    }
    setChecking(true);
    const answer = await verifyNumberCode(sent.codeId, typed);
    setChecking(false);
    if (answer.ok && answer.body.verified) {
      setSent({ ...sent, proved: true });
      setFailure(null);
      return sent.codeId;
    }
    setFailure(failureOf(answer));
    return null;
  }

  /** Forgets the code, so the form asks for a new one: the API no longer takes it. */
  function forget(): void {
    setSent(null);
    setCode("");
    setFailure(null);
  }

  return { code, setCode, checking, failure, proofFor, waitingFor, ask, confirm, forget };
}
