// Who has been fitted (boards F5 and F6): completed fits only, each a friend's first name and the month, with
// what the client has earned and what is left. Each friend earned what a referral earned when they were fitted,
// as ops had set it (docs/decisions/0107-referral-rewards-in-the-console.md), so the API gives each one's visits.
// Whether an invite was opened is the friend's business, so it is never shown here. Empty, it offers the invite
// (F6); the revoke of the client's own card sits at the foot.

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useState } from "react";
import { api, type Refer } from "../api.ts";
import { empty, refer } from "../content.ts";
import { Shell } from "../components/Shell.tsx";
import { EmptyState } from "../components/TabScreens.tsx";
import { useSession } from "../session.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { ShareButton } from "./ReferScreen.tsx";
import { pendingInviteOf, rewardOf, visitsFor } from "./reward.ts";
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
      <p className={capsLook(styles.panelLabel)}>{copy.open}</p>
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
        <Button
          variant="primary"
          size="control"
          className={styles.primary}
          disabled={busy}
          onClick={() => void revoke()}
        >
          {copy.yes}
        </Button>
        <Button
          variant="outline"
          size="control"
          className={styles.outline}
          disabled={busy}
          onClick={() => {
            setAsking(false);
            setFailed(false);
          }}
        >
          {copy.no}
        </Button>
      </div>
    </section>
  );
}

/** Board F5: what the fits have earned, what is left, and each friend fitted. */
function Friends({ state }: { state: Refer }) {
  const copy = refer.fitted;
  const earned = state.fitted.reduce((sum, friend) => sum + visitsFor(friend), 0);
  return (
    <>
      <div className={styles.figures}>
        <p className={styles.figure}>
          <span className={styles.figureCount}>{earned}</span>
          <span className={styles.figureWord}>{copy.earned}</span>
        </p>
        <p className={styles.figure}>
          <span className={styles.figureCount}>{state.credits.visits}</span>
          <span className={styles.figureWord}>{copy.remaining}</span>
        </p>
      </div>
      <ul className={styles.friends}>
        {state.fitted.map((friend, index) => {
          const visits = visitsFor(friend);
          return (
            <li key={`${friend.first_name ?? ""}-${friend.month}-${String(index)}`} className={styles.friend}>
              <div>
                <p className={styles.friendName}>{friend.first_name ?? copy.unnamed}</p>
                <p className={styles.friendWhen}>{copy.when(monthName(friend.month))}</p>
              </div>
              {visits > 0 && <p className={styles.friendEarned}>{copy.each(visits)}</p>}
            </li>
          );
        })}
      </ul>
      <p className={styles.only}>{copy.only}</p>
    </>
  );
}

/** Board F6: nobody fitted yet, and the invite that would change that. */
function Nobody({ state, onChanged }: { state: Refer; onChanged: () => void }) {
  const { me } = useSession();
  return (
    <div className={styles.nobody}>
      <p className={styles.nobodyTitle}>{refer.fitted.none}</p>
      <p className={styles.nobodyLine}>{refer.promise(rewardOf(me))}</p>
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
      {me.state === "fitted" ? (
        <Tracker />
      ) : (
        <EmptyState lines={empty.refer.lines(rewardOf(me), pendingInviteOf(me))} />
      )}
    </Shell>
  );
}
