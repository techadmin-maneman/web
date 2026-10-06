// The account's deletion card: a request to delete the account, which ops carry out or reject.

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { longDate } from "@maneman/web-kit/dates";
import { useState, type ReactNode } from "react";
import { api, type Profile } from "../api.ts";
import { profile } from "../content.ts";
import styles from "./profile.module.css";

/** The client's last request to delete their account, which ops rejected, with their reason. */
function Rejected({ rejected }: { rejected: NonNullable<Profile["deletion_rejected"]> }) {
  const copy = profile.deletion;
  return (
    <>
      <p className={styles.cardBody}>{copy.rejected(longDate(rejected.decided_at))}</p>
      {rejected.reason !== null && <p className={styles.cardBody}>{copy.why(rejected.reason)}</p>}
      <p className={styles.cardBody}>{copy.disagree}</p>
    </>
  );
}

export function DeletionCard({
  deletion,
  rejected,
  onRequested,
}: {
  deletion: Profile["deletion"];
  rejected: Profile["deletion_rejected"];
  onRequested: () => void;
}) {
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
      <h2 className={capsLook(styles.cardLabel)} id="deletion">
        {copy.label}
      </h2>
      <p className={styles.cardBody}>{copy.body}</p>
      {rejected !== null && <Rejected rejected={rejected} />}
      {current()}
    </section>
  );
}
