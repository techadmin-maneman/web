// The account (board G2): a change of mobile number, support on WhatsApp, and
// deletion. The design draws each card's first state; the ones after it are
// written in the same card, with placeholder words (apps/app/src/content.ts).

import { ICONS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { indiaDate, longDate, shortDate } from "@maneman/web-kit/dates";
import { useState, type ReactNode } from "react";
import { api, EXPORT_URL, type Answer, type NumberChange, type Profile } from "../api.ts";
import { login, profile, whatsapp } from "../content.ts";
import { mobileDigits } from "../login/mobile.ts";
import styles from "./profile.module.css";

type Which = "old" | "new";

/** Why a change of number did not start: too many today, a number the API would not take, or anything else. */
function startProblem(answer: { readonly status: number; readonly code: string }): string {
  const copy = profile.change;
  if (answer.code === "rate_limited") return copy.limited;
  if (answer.status === 400) return copy.invalid;
  return copy.failed;
}

/** What one number's code came back as: proven, wrong with the tries left, or not checked at all. */
function codeNote(answer: Answer<{ readonly attempts_left: number | null }>): string {
  if (!answer.ok) return profile.change.failed;
  if (answer.body.attempts_left === null) return profile.change.proven;
  return login.code.mismatch(answer.body.attempts_left);
}

/** What ops decided about the client's last change of number, with their reason for a rejection. */
function Decided({ decided }: { decided: NonNullable<Profile["number_change_decided"]> }) {
  const copy = profile.change;
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

export function NumberChangeCard({
  change,
  decided,
  onChanged,
}: {
  change: NumberChange | null;
  decided: Profile["number_change_decided"];
  onChanged: () => void;
}) {
  const copy = profile.change;
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

  /** Until ops decide it, the client can take the change back. */
  const withdraw = () =>
    once(async () => {
      const answer = await api.withdrawNumberChange();
      setProblem(answer.ok ? null : copy.failed);
      if (answer.ok) onChanged();
    });

  const withdrawal = (
    <>
      {problem !== null && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      <button className={styles.withdraw} type="button" disabled={busy} onClick={() => void withdraw()}>
        {copy.withdraw}
      </button>
    </>
  );

  const check = (requestId: string, pending: readonly Which[]) =>
    once(async () => {
      const next = { ...notes };
      for (const which of pending) {
        if (codes[which].length !== 6) continue;
        next[which] = codeNote(await api.verifyNumberChange(requestId, which, codes[which]));
      }
      setNotes(next);
      onChanged();
    });

  /** Waiting for ops, proving both numbers, or a new number to start from. */
  function current(): ReactNode {
    if (change?.state === "awaiting_ops") {
      return (
        <div aria-busy={busy}>
          <p className={styles.cardBody}>{copy.waiting(change.new_mobile)}</p>
          {withdrawal}
        </div>
      );
    }
    if (change?.state === "verifying") {
      return (
        <form
          noValidate
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            const pending: Which[] = [];
            if (!change.old_verified) pending.push("old");
            if (!change.new_verified) pending.push("new");
            void check(change.request_id, pending);
          }}
        >
          <p className={styles.cardBody}>{copy.codes}</p>
          {(["old", "new"] as const).map((which) => {
            const proven = which === "old" ? change.old_verified : change.new_verified;
            const label = which === "old" ? copy.oldCode : copy.newCode(change.new_mobile);
            return (
              <label key={which} className={styles.formField}>
                <span className={styles.formLabel}>{label}</span>
                {proven ? (
                  <span className={styles.muted}>{copy.proven}</span>
                ) : (
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={codes[which]}
                    onChange={(event) => {
                      setCodes({ ...codes, [which]: event.target.value.replace(/\D/g, "").slice(0, 6) });
                    }}
                  />
                )}
                {!proven && notes[which] !== null && (
                  <span className={styles.error} role="alert">
                    {notes[which]}
                  </span>
                )}
              </label>
            );
          })}
          <Button variant="primary" size="control" className={styles.primary} type="submit" disabled={busy}>
            {copy.check}
          </Button>
          {withdrawal}
        </form>
      );
    }
    return (
      <form
        noValidate
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void start();
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
              setTyped(event.target.value);
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

  return (
    <section className={styles.card} aria-labelledby="change">
      <h2 className={styles.cardLabel} id="change">
        {copy.label}
      </h2>
      {current()}
    </section>
  );
}

export function SupportCard() {
  const copy = profile.support;
  return (
    <section className={styles.card} aria-labelledby="support">
      <h2 className={styles.cardLabel} id="support">
        {copy.label}
      </h2>
      <a className={styles.whatsapp} href={`https://wa.me/${whatsapp.number}`} rel="noopener">
        <Icon d={ICONS.whatsapp} size={21} />
        <span>{copy.message}</span>
      </a>
      <p className={styles.cardHint}>{copy.hint}</p>
    </section>
  );
}

/** The client's rights over their data: a copy of it, and a way to raise a concern (docs/decisions/0049-dpdp.md). */
export function DataCard() {
  const copy = profile.data;
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");
  // One concern per intent: every grievance ops see carries its own answer-time clock, and two
  // rows would be one client's one concern counted twice (docs/decisions/0049-dpdp.md).
  const [busy, once] = useOneAtATime();

  const send = () =>
    once(async () => {
      const answer = await api.raiseGrievance(text);
      setState(answer.ok ? "sent" : "failed");
      if (answer.ok) setWriting(false);
    });

  /** A concern: sent, being written, or the way to raise one. */
  function concern(): ReactNode {
    if (state === "sent") {
      return (
        <p className={styles.cardHint} role="status">
          {copy.sent}
        </p>
      );
    }
    if (!writing) {
      return (
        <Button
          variant="outline"
          size="control"
          className={styles.secondary}
          onClick={() => {
            setWriting(true);
          }}
        >
          {copy.raise}
        </Button>
      );
    }
    return (
      <form
        className={styles.confirm}
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className={styles.formField}>
          <span className={styles.formLabel}>{copy.field}</span>
          <textarea
            className={styles.input}
            rows={4}
            maxLength={2000}
            required
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </label>
        {state === "failed" && (
          <p className={styles.error} role="alert">
            {copy.failed}
          </p>
        )}
        <div className={styles.row}>
          <Button
            variant="primary"
            size="control"
            className={styles.primary}
            type="submit"
            disabled={busy || text.trim() === ""}
          >
            {copy.send}
          </Button>
          <Button
            variant="outline"
            size="control"
            className={styles.secondary}
            onClick={() => {
              setWriting(false);
            }}
          >
            {copy.cancel}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="data">
      <h2 className={styles.cardLabel} id="data">
        {copy.label}
      </h2>
      <p className={styles.cardBody}>{copy.body}</p>
      <ButtonLink variant="outline" size="control" className={styles.secondary} href={EXPORT_URL} download>
        {copy.download}
      </ButtonLink>
      {concern()}
    </section>
  );
}

export function DeletionCard({ deletion, onRequested }: { deletion: Profile["deletion"]; onRequested: () => void }) {
  const copy = profile.deletion;
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  // One request per intent; and one that did not go through says so, rather than closing as if it had.
  const [busy, once] = useOneAtATime();

  const request = () =>
    once(async () => {
      const answer = await api.requestDeletion();
      setFailed(!answer.ok);
      if (!answer.ok) return;
      setConfirming(false);
      onRequested();
    });

  /** The request: made, being confirmed, or the way to make it. */
  function current(): ReactNode {
    if (deletion !== null) {
      return (
        <p className={styles.cardHint} role="status">
          {copy.requested(longDate(deletion.requested_at))}
        </p>
      );
    }
    if (!confirming) {
      return (
        <Button
          variant="danger"
          size="control"
          className={styles.danger}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {copy.request}
        </Button>
      );
    }
    return (
      <div className={styles.confirm} aria-busy={busy}>
        <p className={styles.cardBody}>{copy.confirm}</p>
        {failed && (
          <p className={styles.error} role="alert">
            {copy.failed}
          </p>
        )}
        <div className={styles.row}>
          <Button
            variant="danger"
            size="control"
            className={styles.danger}
            disabled={busy}
            onClick={() => void request()}
          >
            {copy.yes}
          </Button>
          <Button
            variant="outline"
            size="control"
            className={styles.secondary}
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              setFailed(false);
            }}
          >
            {copy.no}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="deletion">
      <h2 className={styles.cardLabel} id="deletion">
        {copy.label}
      </h2>
      <p className={styles.cardBody}>{copy.body}</p>
      {current()}
    </section>
  );
}
