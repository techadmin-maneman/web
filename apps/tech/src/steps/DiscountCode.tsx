// A discount code the client gives the technician on a consultation and fit in one visit, entered on the outcome
// step before the visit closes, since closing it sends the payment link (docs/decisions/0108-discount-codes.md). No
// board draws it. It is asked of the API at once, not queued in the outbox: the technician must hear whether it
// applies while the client is there. No amount is shown: none reaches the phone, and the link carries it.

import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { api } from "../api.ts";
import { oneVisit } from "../content.ts";
import styles from "./steps.module.css";

const copy = oneVisit.code;

const said = (code: string): string => copy.errors[code] ?? copy.errors.unknown ?? "";

export function DiscountCode({ jobId }: { jobId: string }) {
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const apply = async () => {
    setChecking(true);
    setProblem(null);
    const answer = await api.discountCode(jobId, typed.trim());
    setChecking(false);
    if (!answer.ok) {
      setProblem(said(answer.code));
      return;
    }
    setApplied(answer.body.code);
  };

  if (applied !== null) {
    return (
      <p className={styles.note} role="status">
        {copy.applied(applied)}
      </p>
    );
  }

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor="discount-code">
        {copy.label}
      </label>
      <input
        className={styles.box64}
        id="discount-code"
        value={typed}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setTyped(event.target.value);
          setProblem(null);
        }}
      />
      <Button
        variant="outlineOnInk"
        size="control"
        className={styles.second}
        disabled={typed.trim() === "" || checking}
        busy={checking}
        onClick={() => void apply()}
      >
        {checking ? copy.applying : copy.apply}
      </Button>
      {problem !== null && (
        <p className={styles.warn} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
