// A discount code on one of the client's visits, in the Visits tab's last column (docs/decisions/0108-discount-codes.md).
// No board draws it. Ops enter a code on a visit, or take it off, only while the visit is not paid for, linked or
// invoiced (`price_open`), and a consultation, which costs nothing, takes none. The cell keeps what its last answer
// said, so the tab is not read again for it.

import { Button } from "@maneman/ui/Button";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type ClientVisit, type VisitDiscountCode } from "../api.ts";
import { clients } from "../content.ts";
import styles from "./clients.module.css";

const copy = clients.visits.code;

type Step = "showing" | "entering" | "applying" | "removing";

function Shown({ code }: { code: VisitDiscountCode | null }) {
  if (code === null) return <>{copy.none}</>;
  const off = code.amount_off === null ? null : rupees(code.amount_off);
  return (
    <>
      {copy.applied(code.code, off)}
      <span className={styles.closedLine}>{copy.givenBy[code.given_by]}</span>
    </>
  );
}

/** A refusal in the console's words. */
const said = (code: string): string => copy.errors[code] ?? copy.errors.unknown ?? "";

export function VisitCode({ visit }: { visit: ClientVisit }) {
  const [code, setCode] = useState<VisitDiscountCode | null>(visit.discount_code);
  const [step, setStep] = useState<Step>("showing");
  const [typed, setTyped] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const when = fullDate(visit.date);
  const takesACode = visit.price_open && visit.type !== null && visit.type !== "consultation";

  const apply = async () => {
    setStep("applying");
    const answer = await api.enterVisitCode(visit.id, typed.trim());
    if (!answer.ok) {
      setFailure(said(answer.code));
      setStep("entering");
      return;
    }
    setCode(answer.body);
    setTyped("");
    setStep("showing");
  };

  const remove = async () => {
    setStep("removing");
    const answer = await api.removeVisitCode(visit.id);
    setStep("showing");
    if (!answer.ok) {
      setFailure(said(answer.code));
      return;
    }
    setCode(null);
  };

  const problem = failure !== null && (
    <p className={styles.codeError} role="alert">
      {failure}
    </p>
  );

  if (step === "entering" || step === "applying") {
    return (
      <form
        className={styles.codeForm}
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <label htmlFor={`code-${visit.id}`}>
          <VisuallyHidden>{copy.label}</VisuallyHidden>
        </label>
        <input
          id={`code-${visit.id}`}
          className={styles.codeInput}
          type="text"
          autoCapitalize="characters"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setFailure(null);
          }}
        />
        <Button type="submit" variant="primary" size="small" disabled={typed.trim() === "" || step === "applying"}>
          {step === "applying" ? copy.applying : copy.apply}
        </Button>
        <Button
          variant="outline"
          size="small"
          disabled={step === "applying"}
          onClick={() => {
            setStep("showing");
            setFailure(null);
          }}
        >
          {copy.cancel}
        </Button>
        {problem}
      </form>
    );
  }

  return (
    <>
      <Shown code={code} />
      {takesACode && code === null && (
        <Button
          variant="outline"
          size="small"
          className={styles.secondary}
          aria-label={copy.enterLabel(when)}
          onClick={() => {
            setStep("entering");
          }}
        >
          {copy.enter}
        </Button>
      )}
      {visit.price_open && code !== null && (
        <Button
          variant="outline"
          size="small"
          className={styles.secondary}
          aria-label={copy.removeLabel(when)}
          disabled={step === "removing"}
          onClick={() => void remove()}
        >
          {step === "removing" ? copy.removing : copy.remove}
        </Button>
      )}
      {problem}
    </>
  );
}
