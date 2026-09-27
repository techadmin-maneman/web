// Refer (board F1): what a referral earns, the client's credit, and the two ways on: sharing an invite (F2 to
// F4, ShareSheet) and seeing who has been fitted (F5 and F6, /refer/fitted). The tracker shows completed fits
// only (docs/decisions/0048-referrals.md). A client who came through an invite whose credits ops are reviewing,
// or refused, is told so beneath the credit (docs/decisions/0074-hand-offs-and-messages.md; the board draws none).
//
// Until their first fit a client has nothing to vouch for, and the invite's own words ("Had my hair system
// fitted") would not be true: board B2 draws Refer for a lead as reachable but empty.

import { ICONS_P2 } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { useLoad } from "@maneman/ui/useLoad";
import { fullDate, indiaDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, type Refer } from "../api.ts";
import { empty, refer } from "../content.ts";
import { AppLink, Shell } from "../home/Shell.tsx";
import { EmptyState } from "../home/TabScreens.tsx";
import { useSession } from "../session.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { ShareSheet } from "./ShareSheet.tsx";
import styles from "./refer.module.css";

function CreditTile({ credits }: { credits: Refer["credits"] }) {
  if (credits.visits === 0) return null;
  const expiry = credits.earliest_expiry;
  return (
    <div className={styles.credit}>
      <div>
        <p className={styles.creditLabel}>{refer.credit.label}</p>
        {expiry !== null && <p className={styles.creditExpiry}>{refer.credit.expire(fullDate(indiaDate(expiry)))}</p>}
      </div>
      <p className={styles.creditCount}>{credits.visits}</p>
    </div>
  );
}

/** "Share an invite", and the sheet it opens: F1's foot, and F6's empty tracker. */
export function ShareButton({
  state,
  onChanged,
  small = false,
}: {
  state: Refer;
  onChanged: () => void;
  small?: boolean;
}) {
  const [sharing, setSharing] = useState(false);
  return (
    <>
      <button
        className={small ? styles.shareSmall : styles.share}
        type="button"
        onClick={() => {
          setSharing(true);
        }}
      >
        {!small && <Icon d={ICONS_P2.share} size={19} />}
        {refer.share}
      </button>
      {sharing && (
        <ShareSheet
          refer={state}
          onClose={(changed) => {
            setSharing(false);
            if (changed) onChanged();
          }}
        />
      )}
    </>
  );
}

function Invite({ state, onChanged }: { state: Refer; onChanged: () => void }) {
  return (
    <div className={styles.page}>
      <p className={styles.promise}>{refer.promise}</p>
      <CreditTile credits={state.credits} />
      {state.invite_credits !== null && (
        <p className={styles.inviteCredits}>{refer.inviteCredits[state.invite_credits]}</p>
      )}
      <p className={styles.noOther}>{refer.noOther}</p>
      {/* The board puts the two ways on at the foot of the screen, above the tabs. */}
      <div className={styles.actions}>
        <ShareButton state={state} onChanged={onChanged} />
        <AppLink className={styles.quiet} to="/refer/fitted">
          <span>{refer.tracker}</span>
        </AppLink>
      </div>
    </div>
  );
}

function Fitted() {
  const [loaded, retry] = useLoad(useCallback(() => api.refer(), []));
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PageFailed onRetry={retry} />;
  return <Invite state={loaded.value} onChanged={retry} />;
}

export function ReferScreen() {
  const { me } = useSession();
  return (
    <Shell header={{ kind: "tab", title: refer.title }} tab="/refer">
      {me.state === "fitted" ? <Fitted /> : <EmptyState lines={empty.refer.lines} />}
    </Shell>
  );
}
