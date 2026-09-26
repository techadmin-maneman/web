// A1: the mobile number (design/phase2/Client App, board A1).

import { Mark } from "@maneman/ui/Mark";
import { useState } from "react";
import { login } from "../content.ts";
import styles from "./login.module.css";
import { mobileDigits } from "./mobile.ts";

interface Props {
  readonly initial: string;
  readonly busy: boolean;
  readonly error: string | null;
  /** The session ended while the app was open, so the client is told why they are here. */
  readonly ended: boolean;
  readonly onSubmit: (digits: string) => void;
}

export function MobileScreen({ initial, busy, error, ended, onSubmit }: Props) {
  const copy = login.mobile;
  const [typed, setTyped] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const shown = invalid ? copy.errors.invalid : error;

  return (
    <main className={styles.screen}>
      <div className={`${styles.body} ${styles.first}`}>
        <Mark className={styles.mark} />
        <h1 className={styles.title}>{copy.title}</h1>
        {ended && (
          <p className={styles.notice} role="alert">
            {copy.ended}
          </p>
        )}
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const digits = mobileDigits(typed);
            setInvalid(digits === null);
            if (digits !== null) onSubmit(digits);
          }}
        >
          <div className={styles.field}>
            <span className={styles.prefix} aria-hidden="true">
              {copy.prefix}
            </span>
            <input
              className={styles.input}
              name="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              aria-label={copy.label}
              aria-invalid={shown !== null}
              aria-describedby={shown === null ? undefined : "mobile-error"}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          </div>
          {shown !== null && (
            <p className={styles.error} id="mobile-error" role="alert">
              {shown}
            </p>
          )}
          <div className={styles.foot}>
            <button className={styles.primary} type="submit" disabled={busy}>
              {copy.send}
            </button>
            <p className={styles.hint}>{copy.hint}</p>
          </div>
        </form>
      </div>
    </main>
  );
}
