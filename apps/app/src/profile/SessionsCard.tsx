// Where the client is signed in (docs/decisions/0029-sessions.md): each browser, this one marked, and a way to sign
// any other out. A lost or handed-on phone otherwise stays signed in for 90 days from its last use.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { TextButton } from "@maneman/ui/TextLink";
import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { longDate } from "@maneman/web-kit/dates";
import { useLiveLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { api, type SignedIn } from "../api.ts";
import { errors, profile } from "../content.ts";
import styles from "./profile.module.css";

/** How often the list is read again while the profile is open, and as soon as it comes back into view. */
const SESSIONS_FRESH_MS = 5 * 60_000;

export function SessionsCard() {
  const copy = profile.sessions;
  const { loaded, refresh, retry } = useLiveLoad(api.sessions, SESSIONS_FRESH_MS);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  // Each sign-out ends a session for good, so one tap is one request.
  const [busy, once] = useOneAtATime();

  const signOut = (request: () => Promise<{ readonly ok: boolean }>) =>
    once(async () => {
      const answer = await request();
      setFailed(!answer.ok);
      setAsking(false);
      if (answer.ok) refresh();
    });

  // The list is a convenience beside the profile: while it loads, the card is not drawn.
  if (loaded.state === "loading") return null;
  return (
    <section className={styles.card} aria-labelledby="sessions" aria-busy={busy}>
      <h2 className={capsLook(styles.cardLabel)} id="sessions">
        {copy.label}
      </h2>
      {loaded.state === "failed" ? (
        <>
          <InlineMessage tone="error" className={styles.error}>
            {copy.notLoaded}
          </InlineMessage>
          <TextButton className={styles.withdraw} onClick={retry}>
            {errors.retry}
          </TextButton>
        </>
      ) : (
        <Sessions sessions={loaded.value.sessions} busy={busy} signOut={signOut} />
      )}
      {failed && (
        <InlineMessage tone="error" className={styles.error}>
          {copy.failed}
        </InlineMessage>
      )}
      {loaded.state === "loaded" && loaded.value.sessions.filter((each) => !each.this_device).length > 1 && (
        <Others asking={asking} busy={busy} onAsk={setAsking} onYes={() => void signOut(api.signOutOthers)} />
      )}
    </section>
  );
}

function Sessions(props: {
  sessions: readonly SignedIn[];
  busy: boolean;
  signOut: (request: () => Promise<{ readonly ok: boolean }>) => Promise<void>;
}) {
  const copy = profile.sessions;
  return (
    <ul className={styles.consents}>
      {props.sessions.map((session) => {
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
                <TextButton
                  className={styles.withdraw}
                  disabled={props.busy}
                  aria-label={copy.signOutOf(device)}
                  onClick={() => void props.signOut(() => api.signOutSession(session.id))}
                >
                  {copy.signOut}
                </TextButton>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Every other device signed out at once, asked first, since none of them can be signed back in from here. */
function Others(props: { asking: boolean; busy: boolean; onAsk: (asking: boolean) => void; onYes: () => void }) {
  const copy = profile.sessions;
  if (!props.asking) {
    return (
      <Button
        variant="quiet"
        size="control"
        className={styles.secondary}
        disabled={props.busy}
        onClick={() => {
          props.onAsk(true);
        }}
      >
        {copy.signOutOthers}
      </Button>
    );
  }
  return (
    <div className={styles.confirm}>
      <p className={styles.cardBody}>{copy.confirmOthers}</p>
      <div className={styles.row}>
        <Button variant="danger" size="control" className={styles.danger} disabled={props.busy} onClick={props.onYes}>
          {copy.yes}
        </Button>
        <Button
          variant="quiet"
          size="control"
          className={styles.secondary}
          disabled={props.busy}
          onClick={() => {
            props.onAsk(false);
          }}
        >
          {copy.no}
        </Button>
      </div>
    </div>
  );
}
