// Where the client is signed in (docs/decisions/0029-sessions.md): each browser, this one marked, and a way to sign
// any other out. A lost or handed-on phone otherwise stays signed in for 90 days from its last use.

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { longDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useState } from "react";
import { api, type SignedIn } from "../api.ts";
import { profile } from "../content.ts";
import styles from "./profile.module.css";

export function SessionsCard() {
  const copy = profile.sessions;
  const [sessions, setSessions] = useState<readonly SignedIn[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Each sign-out ends a session for good, so one tap is one request.
  const [busy, once] = useOneAtATime();

  const load = useCallback(async () => {
    const answer = await api.sessions();
    if (answer.ok) setSessions(answer.body.sessions);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = (request: () => Promise<{ readonly ok: boolean }>) =>
    once(async () => {
      const answer = await request();
      setFailed(!answer.ok);
      if (answer.ok) await load();
    });

  // The list is a convenience beside the profile: until it loads, the card is not drawn.
  if (sessions === null) return null;
  const others = sessions.filter((session) => !session.this_device);

  return (
    <section className={styles.card} aria-labelledby="sessions" aria-busy={busy}>
      <h2 className={capsLook(styles.cardLabel)} id="sessions">
        {copy.label}
      </h2>
      <ul className={styles.consents}>
        {sessions.map((session) => {
          const device = session.device ?? copy.unknown;
          return (
            <li className={styles.consent} key={session.id}>
              <div className={styles.consentRow}>
                <div>
                  <p className={styles.consentName}>{device}</p>
                  <p className={styles.consentWhen}>
                    {session.this_device ? copy.thisDevice : copy.used(longDate(session.last_used_at))}
                  </p>
                </div>
                {!session.this_device && (
                  <button
                    className={styles.withdraw}
                    type="button"
                    disabled={busy}
                    aria-label={copy.signOutOf(device)}
                    onClick={() => void signOut(() => api.signOutSession(session.id))}
                  >
                    {copy.signOut}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p className={styles.error} role="alert">
          {copy.failed}
        </p>
      )}
      {others.length > 1 && (
        <Button
          variant="outline"
          size="control"
          className={styles.secondary}
          disabled={busy}
          onClick={() => void signOut(api.signOutOthers)}
        >
          {copy.signOutOthers}
        </Button>
      )}
    </section>
  );
}
