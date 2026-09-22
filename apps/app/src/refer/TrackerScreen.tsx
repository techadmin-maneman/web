// Who has been fitted (boards F5 and F6): completed fits only, each a friend's first name and the month, with
// what the client has earned and what is left. Whether an invite was opened is the friend's business, so it is
// never shown here. The revoke of the client's own card sits at the foot (F6).

import { useCallback, useState } from "react";
import { api, type Refer } from "../api.ts";
import { refer } from "../content.ts";
import { Shell } from "../home/Shell.tsx";
import { useLoad } from "../lib/useLoad.ts";
import { CREDITS_PER_REFERRAL } from "../lib/referral.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import styles from "./refer.module.css";

/** "Fitted Aug 2027", from the month the API gives as YYYY-MM. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthName(month: string): string {
  const [year, index] = month.split("-");
  return `${MONTHS[Number(index) - 1] ?? month} ${year ?? ""}`.trim();
}

function RevokeCard({ onRevoked }: { onRevoked: () => void }) {
  const [asking, setAsking] = useState(false);
  const copy = refer.revoke;
  if (!asking) {
    return (
      <button
        className={styles.quiet}
        type="button"
        onClick={() => {
          setAsking(true);
        }}
      >
        {copy.open}
      </button>
    );
  }
  return (
    <div className={styles.confirm}>
      <p className={styles.confirmTitle}>{copy.title}</p>
      <p className={styles.note}>{copy.body}</p>
      <div className={styles.pair}>
        <button
          className={styles.primary}
          type="button"
          onClick={() => {
            void api.revokeCard().then(() => {
              setAsking(false);
              onRevoked();
            });
          }}
        >
          {copy.yes}
        </button>
        <button
          className={styles.secondary}
          type="button"
          onClick={() => {
            setAsking(false);
          }}
        >
          {copy.no}
        </button>
      </div>
    </div>
  );
}

function Fitted({ state, onChanged }: { state: Refer; onChanged: () => void }) {
  const copy = refer.fitted;
  const earned = state.fitted.length * CREDITS_PER_REFERRAL;
  return (
    <div className={styles.page}>
      {state.fitted.length === 0 ? (
        <>
          <p className={styles.promise}>{copy.none}</p>
          <p className={styles.note}>{refer.promise}</p>
        </>
      ) : (
        <>
          <p className={styles.earned}>
            <span>{copy.earned(earned)}</span>
            <span className={styles.remaining}>{copy.remaining(state.credits.visits)}</span>
          </p>
          <ul className={styles.fitted}>
            {state.fitted.map((friend, index) => (
              <li key={`${friend.first_name}-${friend.month}-${String(index)}`} className={styles.friend}>
                <div>
                  <p className={styles.friendName}>{friend.first_name}</p>
                  <p className={styles.note}>{copy.when(monthName(friend.month))}</p>
                </div>
                <p className={styles.note}>{copy.each(CREDITS_PER_REFERRAL)}</p>
              </li>
            ))}
          </ul>
          <p className={styles.note}>{copy.only}</p>
        </>
      )}
      {state.card.state === "personal" && <RevokeCard onRevoked={onChanged} />}
    </div>
  );
}

export function TrackerScreen() {
  const [loaded, retry] = useLoad(useCallback(() => api.refer(), []));
  return (
    <Shell header={{ kind: "back", title: refer.fitted.title, to: "/refer", label: refer.fitted.back }} tab="/refer">
      {loaded.state === "loading" ? (
        <Loading />
      ) : loaded.state === "failed" ? (
        <PageFailed onRetry={retry} />
      ) : (
        <Fitted state={loaded.value} onChanged={retry} />
      )}
    </Shell>
  );
}
