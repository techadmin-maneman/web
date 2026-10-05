// The account's change of mobile number (board G2): both numbers proved by a code each, then ops decide. The design
// draws the card's first state; the ones after it are written in the same card, with placeholder words.

import { capsLook } from "@maneman/ui/Caps";
import { ONE_TIME_CODE } from "../../../../src/policy/one-time-code.ts";
import { Button } from "@maneman/ui/Button";
import { codeDigits } from "@maneman/ui/CodeField";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { mobileDigits } from "@maneman/web-kit/mobile";
import { useState, type ReactNode } from "react";
import { api, type Answer, type NumberChange, type Profile } from "../api.ts";
import { login, profile } from "../content.ts";
import styles from "./profile.module.css";

const copy = profile.change;

type Which = "old" | "new";

/** Why a change of number did not start: too many today, a number the API would not take, or anything else. */
function startProblem(answer: { readonly status: number; readonly code: string }): string {
  if (answer.code === "rate_limited") return copy.limited;
  if (answer.status === 400) return copy.invalid;
  return copy.failed;
}

/** What one number's code came back as: proven, wrong with the tries left, or not checked at all. */
function codeNote(answer: Answer<{ readonly attempts_left: number | null }>): string {
  if (!answer.ok) return copy.failed;
  if (answer.body.attempts_left === null) return copy.proven;
  return login.code.mismatch(answer.body.attempts_left);
}

/** What ops decided about the client's last change of number, with their reason for a rejection. */
function Decided({ decided }: { decided: NonNullable<Profile["number_change_decided"]> }) {
  const date = shortDate(indiaDate(decided.decided_at));
  return (
    <>
      <p className={styles.cardBody}>
        {decided.state === "confirmed"
          ? copy.confirmed(decided.new_mobile, date)
          : copy.rejected(decided.new_mobile, date)}
      </p>
      {decided.reason !== null && <p className={styles.cardBody}>{copy.why(decided.reason)}</p>}
    </>
  );
}

/** Until ops decide it, the client can take the change back. */
function Withdrawal({ problem, busy, onWithdraw }: { problem: string | null; busy: boolean; onWithdraw: () => void }) {
  return (
    <>
      {problem !== null && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      <button className={styles.withdraw} type="button" disabled={busy} onClick={onWithdraw}>
        {copy.withdraw}
      </button>
    </>
  );
}

/** A code to each number: the one already proven says so, and a wrong one says how many tries are left. */
function ProvingCodes({
  change,
  codes,
  notes,
  busy,
  onCode,
  onCheck,
  children,
}: {
  change: NumberChange;
  codes: Record<Which, string>;
  notes: Record<Which, string | null>;
  busy: boolean;
  onCode: (which: Which, code: string) => void;
  onCheck: (pending: readonly Which[]) => void;
  children: ReactNode;
}) {
  const proven = (which: Which) => (which === "old" ? change.old_verified : change.new_verified);
  return (
    <form
      noValidate
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        onCheck((["old", "new"] as const).filter((which) => !proven(which)));
      }}
    >
      <p className={styles.cardBody}>{copy.codes}</p>
      {(["old", "new"] as const).map((which) => (
        <label key={which} className={styles.formField}>
          <span className={styles.formLabel}>{which === "old" ? copy.oldCode : copy.newCode(change.new_mobile)}</span>
          {proven(which) ? (
            <span className={styles.muted}>{copy.proven}</span>
          ) : (
            <input
              className={styles.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={ONE_TIME_CODE.digits}
              value={codes[which]}
              onChange={(event) => {
                onCode(which, codeDigits(event.target.value));
              }}
            />
          )}
          {!proven(which) && notes[which] !== null && (
            <span className={styles.error} role="alert">
              {notes[which]}
            </span>
          )}
        </label>
      ))}
      <Button variant="primary" size="control" className={styles.primary} type="submit" disabled={busy}>
        {copy.check}
      </Button>
      {children}
    </form>
  );
}

/** The new number to move to, under what ops decided about the last change, if anything. */
function StartChange({
  decided,
  typed,
  problem,
  busy,
  onTyped,
  onStart,
}: {
  decided: Profile["number_change_decided"];
  typed: string;
  problem: string | null;
  busy: boolean;
  onTyped: (typed: string) => void;
  onStart: () => void;
}) {
  return (
    <form
      noValidate
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        onStart();
      }}
    >
      {decided !== null && <Decided decided={decided} />}
      <p className={styles.cardBody}>{copy.body}</p>
      <div className={styles.numberField}>
        <span className={styles.prefix} aria-hidden="true">
          {copy.prefix}
        </span>
        <input
          className={styles.numberInput}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={copy.placeholder}
          aria-label={copy.placeholder}
          value={typed}
          onChange={(event) => {
            onTyped(event.target.value);
          }}
        />
      </div>
      {problem !== null && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      <Button variant="primary" size="control" className={styles.primary} type="submit" disabled={busy}>
        {copy.start}
      </Button>
    </form>
  );
}

export function NumberChangeCard({
  change,
  decided,
  onChanged,
}: {
  change: NumberChange | null;
  decided: Profile["number_change_decided"];
  onChanged: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [codes, setCodes] = useState<Record<Which, string>>({ old: "", new: "" });
  const [notes, setNotes] = useState<Record<Which, string | null>>({ old: null, new: null });
  const [problem, setProblem] = useState<string | null>(null);
  // Starting again withdraws the request just made and sends a fresh pair of codes, and each
  // check spends one of a small budget of attempts. Either way, two taps cost twice for one intent.
  const [busy, once] = useOneAtATime();

  const start = () =>
    once(async () => {
      const digits = mobileDigits(typed);
      if (digits === null) {
        setProblem(copy.invalid);
        return;
      }
      const answer = await api.startNumberChange(digits);
      if (answer.ok) {
        setProblem(null);
        setCodes({ old: "", new: "" });
        setNotes({ old: null, new: null });
        onChanged();
      } else {
        setProblem(startProblem(answer));
      }
    });

  const withdraw = () =>
    once(async () => {
      const answer = await api.withdrawNumberChange();
      setProblem(answer.ok ? null : copy.failed);
      if (answer.ok) onChanged();
    });

  const check = (requestId: string, pending: readonly Which[]) =>
    once(async () => {
      const next = { ...notes };
      for (const which of pending) {
        if (codes[which].length !== ONE_TIME_CODE.digits) continue;
        next[which] = codeNote(await api.verifyNumberChange(requestId, which, codes[which]));
      }
      setNotes(next);
      onChanged();
    });

  const withdrawal = <Withdrawal problem={problem} busy={busy} onWithdraw={() => void withdraw()} />;

  return (
    <section className={styles.card} aria-labelledby="change">
      <h2 className={capsLook(styles.cardLabel)} id="change">
        {copy.label}
      </h2>
      {change?.state === "awaiting_ops" && (
        <div aria-busy={busy}>
          <p className={styles.cardBody}>{copy.waiting(change.new_mobile)}</p>
          {withdrawal}
        </div>
      )}
      {change?.state === "verifying" && (
        <ProvingCodes
          change={change}
          codes={codes}
          notes={notes}
          busy={busy}
          onCode={(which, code) => {
            setCodes({ ...codes, [which]: code });
          }}
          onCheck={(pending) => void check(change.request_id, pending)}
        >
          {withdrawal}
        </ProvingCodes>
      )}
      {change === null && (
        <StartChange
          decided={decided}
          typed={typed}
          problem={problem}
          busy={busy}
          onTyped={setTyped}
          onStart={() => void start()}
        />
      )}
    </section>
  );
}
