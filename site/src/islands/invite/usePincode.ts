import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { referral } from "../../content/referral.ts";
import { checkPincode, type PincodeAnswer } from "../../lib/api.ts";
import { currentStep, pushStep } from "./history.ts";
import { takeEarlyCheck } from "./page.ts";

/** What is wrong with the pincode typed, or null when it reads as one. */
function pincodeProblem(pincode: string): string | null {
  if (pincode === "") return referral.pincode.empty;
  if (!/^[1-8]\d{5}$/.test(pincode)) return referral.pincode.invalid;
  return null;
}

/** The pincode check: the field, the API's answer, and where focus goes as the answer comes and goes. */
export function usePincode() {
  const [pincode, setPincode] = useState("");
  const [answer, setAnswer] = useState<PincodeAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Check was tapped before the island woke.
  const [checkedEarly, setCheckedEarly] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Where focus goes once the pincode's answer has drawn, or gone again.
  const focusNext = useRef<"answer" | "field" | null>(null);

  // Digits typed before the island woke, which it does once the page is idle, are kept rather than cleared. This and the
  // answer to an early Check run before the first paint, so the button the page showed as checking never reads Check
  // again in between.
  useLayoutEffect(() => {
    const typed = field.current?.value.replace(/\D/g, "").slice(0, 6) ?? "";
    if (typed !== "") setPincode(typed);
    if (takeEarlyCheck()) setCheckedEarly(true);
  }, []);

  // A Check tapped before then is answered once the field holds those digits, as a tap now would be. The submit is sent
  // as an event: Safari before 16 has no requestSubmit.
  useLayoutEffect(() => {
    if (checkedEarly) field.current?.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, [checkedEarly]);

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
    if (checking) return;
    const problem = pincodeProblem(pincode);
    if (problem !== null) {
      setError(problem);
      setAnswer(null);
      field.current?.focus();
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
    show(found.body);
    pushStep("form", found.body);
  }

  /** An answer, with focus moved to it; or, for none, the field again. */
  function show(next: PincodeAnswer | null) {
    focusNext.current = next === null ? "field" : "answer";
    setAnswer(next);
  }

  /** Back to the field, from the form the answer opened: the same as the browser's Back. */
  function change() {
    if (currentStep() === "form") {
      history.back();
      return;
    }
    show(null);
  }

  return { pincode, setPincode, answer, setAnswer, error, checking, check, show, change, panel, answerHeading, field };
}

export type PincodeCheck = ReturnType<typeof usePincode>;
