// Who has been fitted (boards F5 and F6): completed fits only, each a friend's first name and the month, with
// what the client has earned and what is left. Whether an invite was opened is the friend's business, so it is
// never shown here. Empty, it offers the invite (F6); the revoke of the client's own card sits at the foot.

import { useCallback, useState } from "react";
import { api, type Refer } from "../api.ts";
import { empty, refer } from "../content.ts";
import { Shell } from "../home/Shell.tsx";
import { EmptyState } from "../home/TabScreens.tsx";
import { useLoad } from "../lib/useLoad.ts";
import { CREDITS_PER_REFERRAL } from "../lib/referral.ts";
import { useOneAtATime } from "../lib/useOneAtATime.ts";
import { useSession } from "../session.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { ShareButton } from "./ReferScreen.tsx";
import styles from "./refer.module.css";

/** "Fitted Aug 2027", from the month the API gives as YYYY-MM. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthName(month: string): string {
  const [year, index] = month.split("-");
  return `${MONTHS[Number(index) - 1] ?? month} ${year ?? ""}`.trim();
}

/** Board F6's revoke: the client's own card comes down only once the API says it has. */
function RevokeCard({ onRevoked }: { onRevoked: () => void }) {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, once] = useOneAtATime();
  const copy = refer.revoke;

  const revoke = () =>
    once(async () => {
      const answer = await api.revokeCard();
      setFailed(!answer.ok);
      if (!answer.ok) return;
      setAsking(false);
      onRevoked();
    });

  if (!asking) {
    return (
      <button
        className={styles.quiet}
        type="button"
        onClick={() => {
          setAsking(true);
        }}
      >
        <span>{copy.open}</span>
      </button>
    );
  }
  return (
    <section className={styles.panel} aria-labelledby="revoke" aria-busy={busy}>
      <p className={styles.panelLabel}>{copy.open}</p>
      <h2 className={styles.panelTitle} id="revoke">
        {copy.title}
      </h2>
      <p className={styles.panelBody}>{copy.body}</p>
      {failed && (
        <p className={styles.problem} role="alert">
          {copy.failed}
        </p>
      )}
      <div className={styles.pair}>
        <button className={styles.primary} type="button" disabled={busy} onClick={() => void revoke()}>
          {copy.yes}
        </button>
        <button
          className={styles.outline}
          type="button"
          disabled={busy}
          onClick={() => {
            setAsking(false);
            setFailed(false);
          }}
        >
          {copy.no}
        </button>
      </div>
    </section>
  );
}

/** Board F5: what the fits have earned, what is left, and each friend fitted. */
function Friends({ state }: { state: Refer }) {
  const copy = refer.fitted;
  return (
    <>
      <div className={styles.figures}>
        <p className={styles.figure}>
          <span className={styles.figureCount}>{state.fitted.length * CREDITS_PER_REFERRAL}</span>
          <span className={styles.figureWord}>{copy.earned}</span>
        </p>
        <p className={styles.figure}>
          <span className={styles.figureCount}>{state.credits.visits}</span>
          <span className={styles.figureWord}>{copy.remaining}</span>
        </p>
      </div>
      <ul className={styles.friends}>
        {state.fitted.map((friend, index) => (
          <li key={`${friend.first_name}-${friend.month}-${String(index)}`} className={styles.friend}>
            <div>
              <p className={styles.friendName}>{friend.first_name}</p>
              <p className={styles.friendWhen}>{copy.when(monthName(friend.month))}</p>
            </div>
            <p className={styles.friendEarned}>{copy.each(CREDITS_PER_REFERRAL)}</p>
          </li>
        ))}
      </ul>
      <p className={styles.only}>{copy.only}</p>
    </>
  );
}

/** Board F6: nobody fitted yet, and the invite that would change that. */
function Nobody({ state, onChanged }: { state: Refer; onChanged: () => void }) {
  return (
    <div className={styles.nobody}>
      <p className={styles.nobodyTitle}>{refer.fitted.none}</p>
      <p className={styles.nobodyLine}>{refer.promise}</p>
      <ShareButton state={state} onChanged={onChanged} small />
    </div>
  );
}

function Tracker() {
  const [loaded, retry] = useLoad(useCallback(() => api.refer(), []));
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PageFailed onRetry={retry} />;
  const state = loaded.value;
  return (
    <div className={styles.tracker}>
      {state.fitted.length === 0 ? <Nobody state={state} onChanged={retry} /> : <Friends state={state} />}
      {state.card.state === "personal" && <RevokeCard onRevoked={retry} />}
    </div>
  );
}

export function TrackerScreen() {
  const { me } = useSession();
  return (
    <Shell header={{ kind: "back", title: refer.fitted.title, to: "/refer", label: refer.fitted.back }} tab="/refer">
      {me.state === "fitted" ? <Tracker /> : <EmptyState lines={empty.refer.lines} />}
    </Shell>
  );
}
