import { useEffect, useRef, useState } from "preact/hooks";
import { referral } from "../../content/referral.ts";
import { checkPincode, type PincodeAnswer } from "../../lib/api.ts";

/** The pincode check: the field, the API's answer, and where focus goes as the answer comes and goes. */
export function usePincode() {
  const [pincode, setPincode] = useState("");
  const [answer, setAnswer] = useState<PincodeAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Where focus goes once the pincode's answer has drawn, or gone again.
  const focusNext = useRef<"answer" | "field" | null>(null);

  // The answer is read out by moving focus to it, and the page brings it, with the form beneath, into view.
  useEffect(() => {
    if (focusNext.current === "answer") {
      answerHeading.current?.focus({ preventScroll: true });
      // The page's own scroll-behavior is smooth, and instant for a visitor who asks for reduced motion.
      panel.current?.scrollIntoView({ block: "start" });
    }
    if (focusNext.current === "field") field.current?.focus();
    focusNext.current = null;
  }, [answer]);

  async function check(event: Event) {
    event.preventDefault();
    if (!/^[1-8]\d{5}$/.test(pincode)) {
      setError(referral.pincode.invalid);
      setAnswer(null);
      return;
    }
    setChecking(true);
    setError(null);
    const found = await checkPincode(pincode);
    setChecking(false);
    if (!found.ok) {
      setError(referral.pincode.failed);
      return;
    }
    focusNext.current = "answer";
    setAnswer(found.body);
  }

  /** Back to the field, from the form the answer opened. */
  function change() {
    focusNext.current = "field";
    setAnswer(null);
  }

  return { pincode, setPincode, answer, setAnswer, error, checking, check, change, panel, answerHeading, field };
}

export type PincodeCheck = ReturnType<typeof usePincode>;
