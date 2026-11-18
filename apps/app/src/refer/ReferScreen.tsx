// Rewards (design/client-redesign, the rewards screen): what a referral earns, as ops set it
// (docs/decisions/0107-referral-rewards-in-the-console.md), the free service visits left and earned, the ways to send
// an invite (the share sheet behind them, where the card is chosen and its photographs agreed to), the invite as the
// friend sees it, the friends fitted, with the whole tracker a page of its own (/rewards/invited), and how it works. The tracker shows completed fits only (docs/decisions/0048-referrals.md). A client who came through an invite whose credits ops are reviewing,
// or refused, is told so beneath the credit (docs/decisions/0074-hand-offs-and-messages.md; the board draws none).
//
// Refer opens at the client's first consultation (ADR 0218): before it a client has nothing to vouch for, and the
// design draws Refer for a lead as reachable but empty. It says when their invite opens, and names the invite they
// came with while its visits wait on their fit.

import { APP_ICONS, GLYPHS, ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { NumberedSteps } from "@maneman/ui/NumberedSteps";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { TextButton, TextLink, textLinkLook } from "@maneman/ui/TextLink";
import { Icon } from "@maneman/ui/Icon";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaDate, listDate, listMonth, yearInIndia } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, type Refer } from "../api.ts";
import { empty, LEGAL_URLS, refer } from "../content.ts";
import { AppLink, Shell } from "../frame/Shell.tsx";
import { EmptyState } from "@maneman/ui/EmptyState";
import { useSession } from "../session.ts";
import { Loading } from "@maneman/ui/States";
import { PageFailed } from "../frame/PageFailed.tsx";
import { pendingInviteOf, rewardOf } from "./reward.ts";
import { CardPreview } from "./CardPreview.tsx";
import { sentCard } from "./share-flow.ts";
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
            {expiry === null || state.credits.visits === 0
              ? refer.left
              : refer.leftUseBy(listDate(indiaDate(expiry), yearInIndia(apiNow())))}
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

/** The ways to send the invite: WhatsApp first, then the link and any other app. Each opens the share sheet, where the
 * card is chosen and its photographs agreed to, except the link, copied here. */
function ShareActions({ link, onShare }: { link: string; onShare: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.ways}>
      <Button variant="primary" size="action" className={shared.share} onClick={onShare}>
        <Icon d={ICONS.whatsapp} size="md" />
        {refer.inviteOnWhatsApp}
      </Button>
      <div className={styles.waysRow}>
        <Button
          variant="outline"
          size="control"
          className={styles.way}
          onClick={() => {
            // A phone that will not copy has the sheet's other ways.
            navigator.clipboard.writeText(link).then(() => {
              setCopied(true);
            }, onShare);
          }}
        >
          <Icon d={GLYPHS.copyLink} size="sm" />
          {copied ? refer.preview.copied : refer.preview.copy}
        </Button>
        <Button variant="outline" size="control" className={styles.way} onClick={onShare}>
          <Icon d={GLYPHS.otherApps} size="sm" />
          {refer.preview.other}
        </Button>
      </div>
    </div>
  );
}

/** The invite as the friend will see it: the picture, who sent it and what it offers, and the link. */
function FriendSees({ state, onChange }: { state: Refer; onChange: () => void }) {
  const { me } = useSession();
  return (
    <section aria-labelledby="friend-sees">
      <h2 className={styles.section} id="friend-sees">
        {refer.sees.title}
      </h2>
      <div className={styles.preview}>
        <CardPreview shown={sentCard(state, null)} />
        <div className={styles.previewText}>
          <p className={styles.previewTitle}>{refer.preview.heading(state.named ? me.first_name : null)}</p>
          <p className={styles.previewLine}>{refer.preview.body(rewardOf(me))}</p>
          <p className={styles.previewLine}>{state.link.replace(/^https?:\/\//, "")}</p>
        </div>
      </div>
      <p className={styles.note}>{refer.sees.note}</p>
      <TextButton className={styles.change} onClick={onChange}>
        {refer.sees.change}
      </TextButton>
    </section>
  );
}

/** How an invite goes, from the link to the visits, and the offer's terms on the site. */
function HowItWorks() {
  const { me } = useSession();
  return (
    <section aria-labelledby="how">
      <h2 className={styles.section} id="how">
        {refer.how.label}
      </h2>
      <NumberedSteps steps={refer.how.steps(rewardOf(me))} />
      <TextLink className={styles.terms} href={LEGAL_URLS[import.meta.env.MM_ENV].offerTerms} newTab>
        {refer.offerTerms}
      </TextLink>
    </section>
  );
}

function Invite({ state, onChanged }: { state: Refer; onChanged: () => void }) {
  const [sharing, setSharing] = useState(false);
  const share = () => {
    setSharing(true);
  };
  return (
    <div className={styles.page}>
      <RewardCard state={state} />
      {state.invite_credits !== null && (
        <p className={styles.inviteCredits}>{refer.inviteCredits[state.invite_credits]}</p>
      )}
      <ShareActions link={state.link} onShare={share} />
      <FriendSees state={state} onChange={share} />
      <Fitted state={state} />
      <AppLink className={textLinkLook({ className: styles.tracker })} to="/rewards/invited">
        {refer.tracker}
      </AppLink>
      <HowItWorks />
      {sharing && (
        <ShareSheet
          refer={state}
          onClose={(changed) => {
            setSharing(false);
            if (changed) onChanged();
          }}
        />
      )}
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
