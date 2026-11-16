// Rewards (design/client-redesign, the rewards screen): what a referral earns, as ops set it
// (docs/decisions/0107-referral-rewards-in-the-console.md), the free service visits left and earned, sharing an invite
// (ShareSheet), and the friends fitted, with the whole tracker a page of its own (/rewards/invited). The tracker shows completed fits only (docs/decisions/0048-referrals.md). A client who came through an invite whose credits ops are reviewing,
// or refused, is told so beneath the credit (docs/decisions/0074-hand-offs-and-messages.md; the board draws none).
//
// Refer opens at the client's first consultation (ADR 0218): before it a client has nothing to vouch for, and the
// design draws Refer for a lead as reachable but empty. It says when their invite opens, and names the invite they
// came with while its visits wait on their fit.

import { APP_ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { textLinkLook } from "@maneman/ui/TextLink";
import { Icon } from "@maneman/ui/Icon";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { dayMonth, indiaDate, listMonth, yearInIndia } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, type Refer } from "../api.ts";
import { empty, refer } from "../content.ts";
import { AppLink, Shell } from "../frame/Shell.tsx";
import { EmptyState } from "@maneman/ui/EmptyState";
import { useSession } from "../session.ts";
import { Loading } from "@maneman/ui/States";
import { PageFailed } from "../frame/PageFailed.tsx";
import { pendingInviteOf, rewardOf } from "./reward.ts";
import { ShareSheet } from "./ShareSheet.tsx";
import shared from "./refer.module.css";
import styles from "./refer-screen.module.css";

/** The promise on navy, over the free service visits left and how many invites have earned. */
function RewardCard({ state }: { state: Refer }) {
  const { me } = useSession();
  const expiry = state.credits.earliest_expiry;
  const earned = state.fitted.reduce((sum, friend) => sum + friend.visits, 0);
  return (
    <section className={styles.card} aria-labelledby="reward">
      <h2 className={styles.promise} id="reward">
        {refer.promise(rewardOf(me))}
      </h2>
      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt>
            {expiry === null || state.credits.visits === 0 ? refer.left : refer.leftUseBy(dayMonth(indiaDate(expiry)))}
          </dt>
          <dd>{state.credits.visits}</dd>
        </div>
        <div className={styles.figure}>
          <dt>{refer.earned}</dt>
          <dd>{earned}</dd>
        </div>
      </dl>
    </section>
  );
}

/** The friends fitted through the client's invites, newest first, each with the visits they earned. */
function Fitted({ state }: { state: Refer }) {
  return (
    <section aria-labelledby="fitted">
      <h2 className={styles.section} id="fitted">
        {refer.fittedTitle}
      </h2>
      {state.fitted.length > 0 && (
        <ListRows>
          {state.fitted.map((friend, index) => (
            <ListRow
              key={`${friend.month}-${String(index)}`}
              title={friend.first_name ?? refer.fitted.unnamed}
              meta={refer.fitted.when(listMonth(friend.month, yearInIndia(apiNow())))}
              end={<span className={styles.plus}>{refer.plusVisits(friend.visits)}</span>}
            />
          ))}
        </ListRows>
      )}
      <p className={styles.note}>{refer.fitted.only}</p>
    </section>
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
        className={small ? styles.shareSmall : shared.share}
        onClick={() => {
          setSharing(true);
        }}
      >
        {!small && <Icon d={APP_ICONS.share} size="sm" />}
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
  return (
    <div className={styles.page}>
      <RewardCard state={state} />
      {state.invite_credits !== null && (
        <p className={styles.inviteCredits}>{refer.inviteCredits[state.invite_credits]}</p>
      )}
      <ShareButton state={state} onChanged={onChanged} />
      <Fitted state={state} />
      <AppLink className={textLinkLook({ className: styles.tracker })} to="/rewards/invited">
        {refer.tracker}
      </AppLink>
    </div>
  );
}

function OpenInvite() {
  const [loaded, retry] = useLoad(useCallback(() => api.refer(), []));
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PageFailed onRetry={retry} />;
  return <Invite state={loaded.value} onChanged={retry} />;
}

export function ReferScreen() {
  const { me } = useSession();
  return (
    <Shell header={{ kind: "tab", title: refer.title }} tab="/rewards">
      {me.refers ? (
        <OpenInvite />
      ) : (
        <EmptyState look="page" lines={empty.refer.lines(rewardOf(me), pendingInviteOf(me))} />
      )}
    </Shell>
  );
}
