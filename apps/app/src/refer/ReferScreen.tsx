// Refer: what a referral earns, as ops set it (docs/decisions/0107-referral-rewards-in-the-console.md),
// the client's credit, and the two ways on: sharing an invite (ShareSheet) and seeing who has been
// fitted (/refer/fitted). The tracker shows completed fits only (docs/decisions/0048-referrals.md). A client who came through an invite whose credits ops are reviewing,
// or refused, is told so beneath the credit (docs/decisions/0074-hand-offs-and-messages.md; the board draws none).
//
// Until their first fit a client has nothing to vouch for, and the invite's own words ("Got my hair system
// fitted") would not be true: the design draws Refer for a lead as reachable but empty. It says when their invite
// opens, and names the invite they came with while its visits wait on that fit.

import { APP_ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { useLoad } from "@maneman/ui/useLoad";
import { fullDate, indiaDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, type Refer } from "../api.ts";
import { empty, refer } from "../content.ts";
import { AppLink, Shell } from "../components/Shell.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { useSession } from "../session.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { pendingInviteOf, rewardOf } from "./reward.ts";
import { ShareSheet } from "./ShareSheet.tsx";
import styles from "./refer.module.css";

function CreditTile({ credits }: { credits: Refer["credits"] }) {
  if (credits.visits === 0) return null;
  const expiry = credits.earliest_expiry;
  return (
    <div className={styles.credit}>
      <p className={styles.creditLabel}>{refer.credit.count(credits.visits)}</p>
      {expiry !== null && <p className={styles.creditExpiry}>{refer.credit.useBy(fullDate(indiaDate(expiry)))}</p>}
    </div>
  );
}

/** "Share an invite", and the sheet it opens: Refer's foot, and the empty tracker's. */
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
      <Button
        variant="primary"
        size={small ? "control" : "action"}
        className={small ? styles.shareSmall : styles.share}
        onClick={() => {
          setSharing(true);
        }}
      >
        {!small && <Icon d={APP_ICONS.share} size={19} />}
        {refer.share}
      </Button>
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
  const { me } = useSession();
  return (
    <div className={styles.page}>
      <p className={styles.promise}>{refer.promise(rewardOf(me))}</p>
      <CreditTile credits={state.credits} />
      {state.invite_credits !== null && (
        <p className={styles.inviteCredits}>{refer.inviteCredits[state.invite_credits]}</p>
      )}
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
      {me.state === "fitted" ? <Fitted /> : <EmptyState lines={empty.refer.lines(rewardOf(me), pendingInviteOf(me))} />}
    </Shell>
  );
}
