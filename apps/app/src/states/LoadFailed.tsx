// Board B3's error state: the app could not load, with a way to try again and
// a way to reach us. When the phone kept a Home with a visit on it, the visit
// is still booked, and the screen says so.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { useEffect } from "react";
import { states, whatsapp } from "../content.ts";
import { nameInTitle } from "../lib/arrival.ts";
import styles from "./states.module.css";

export function LoadFailed({ booked, onRetry }: { booked: boolean; onRetry: () => void }) {
  const copy = states.error;
  useEffect(() => {
    nameInTitle(copy.title);
  }, [copy.title]);
  return (
    <main className={styles.failed}>
      <div role="alert">
        <h1 className={styles.title}>{copy.title}</h1>
        {booked && <p className={styles.booked}>{copy.booked}</p>}
      </div>
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.retry} onClick={onRetry}>
          {copy.retry}
        </Button>
        <ButtonLink
          variant="outline"
          size="small"
          className={styles.message}
          href={`https://wa.me/${whatsapp.number}`}
          rel="noopener"
        >
          {copy.message}
        </ButtonLink>
      </div>
    </main>
  );
}
