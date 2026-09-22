// The account (board G2): a change of mobile number, support on WhatsApp, and
// deletion. The design draws each card's first state; the ones after it are
// written in the same card, with placeholder words (apps/app/src/content.ts).

import { ICONS } from "@maneman/brand/icons";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, EXPORT_URL, type NumberChange, type Profile } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { login, profile, whatsapp } from "../content.ts";
import { mobileDigits } from "../login/mobile.ts";
import styles from "./profile.module.css";

type Which = "old" | "new";

/** "A code goes to both numbers, then we confirm with you before it takes effect." */
export function NumberChangeCard({ change, onChanged }: { change: NumberChange | null; onChanged: () => void }) {
  const copy = profile.change;
  const [typed, setTyped] = useState("");
  const [codes, setCodes] = useState<Record<Which, string>>({ old: "", new: "" });
  const [notes, setNotes] = useState<Record<Which, string | null>>({ old: null, new: null });
  const [problem, setProblem] = useState<string | null>(null);

  async function start() {
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
      setProblem(answer.code === "rate_limited" ? copy.limited : answer.status === 400 ? copy.invalid : copy.failed);
    }
  }

  async function check(requestId: string, pending: readonly Which[]) {
    const next = { ...notes };
    for (const which of pending) {
      if (codes[which].length !== 6) continue;
      const answer = await api.verifyNumberChange(requestId, which, codes[which]);
      next[which] = !answer.ok
        ? copy.failed
        : answer.body.attempts_left === null
          ? copy.proven
          : login.code.mismatch(answer.body.attempts_left);
    }
    setNotes(next);
    onChanged();
  }

  return (
    <section className={styles.card} aria-labelledby="change">
      <h2 className={styles.cardLabel} id="change">
        {copy.label}
      </h2>
      {change?.state === "awaiting_ops" ? (
        <p className={styles.cardBody}>{copy.waiting(change.new_mobile)}</p>
      ) : change?.state === "verifying" ? (
        <form
          noValidate
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
          <button className={styles.primary} type="submit">
            {copy.check}
          </button>
        </form>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
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
          <button className={styles.primary} type="submit">
            {copy.start}
          </button>
        </form>
      )}
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

  async function send() {
    const answer = await api.raiseGrievance(text);
    setState(answer.ok ? "sent" : "failed");
    if (answer.ok) setWriting(false);
  }

  return (
    <section className={styles.card} aria-labelledby="data">
      <h2 className={styles.cardLabel} id="data">
        {copy.label}
      </h2>
      <p className={styles.cardBody}>{copy.body}</p>
      <a className={styles.secondary} href={EXPORT_URL} download>
        {copy.download}
      </a>
      {state === "sent" ? (
        <p className={styles.cardHint} role="status">
          {copy.sent}
        </p>
      ) : writing ? (
        <form
          className={styles.confirm}
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
            <button className={styles.primary} type="submit" disabled={text.trim() === ""}>
              {copy.send}
            </button>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => {
                setWriting(false);
              }}
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button
          className={styles.secondary}
          type="button"
          onClick={() => {
            setWriting(true);
          }}
        >
          {copy.raise}
        </button>
      )}
    </section>
  );
}

export function DeletionCard({ deletion, onRequested }: { deletion: Profile["deletion"]; onRequested: () => void }) {
  const copy = profile.deletion;
  const [confirming, setConfirming] = useState(false);

  async function request() {
    const answer = await api.requestDeletion();
    setConfirming(false);
    if (answer.ok) onRequested();
  }

  return (
    <section className={styles.card} aria-labelledby="deletion">
      <h2 className={styles.cardLabel} id="deletion">
        {copy.label}
      </h2>
      <p className={styles.cardBody}>{copy.body}</p>
      {deletion !== null ? (
        <p className={styles.cardHint} role="status">
          {copy.requested(longDate(deletion.requested_at))}
        </p>
      ) : confirming ? (
        <div className={styles.confirm}>
          <p className={styles.cardBody}>{copy.confirm}</p>
          <div className={styles.row}>
            <button className={styles.danger} type="button" onClick={() => void request()}>
              {copy.yes}
            </button>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {copy.no}
            </button>
          </div>
        </div>
      ) : (
        <button
          className={styles.danger}
          type="button"
          onClick={() => {
            setConfirming(true);
          }}
        >
          {copy.request}
        </button>
      )}
    </section>
  );
}
