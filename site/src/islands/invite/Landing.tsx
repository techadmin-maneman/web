// The referral landing at /r/:code (docs/decisions/0027-referral-landing.md): a friend arrives with someone's invite,
// and the pincode decides what the page is, a consultation form where we come and a waitlist where we do not, each
// asking for everything at once, as the design draws it.
//
// The invite arrives in the page itself: the mm-site Worker writes it onto #invite, so the referrer's name is there
// before any JavaScript runs and the preview WhatsApp fetches is the referrer's own card (site/src/worker.ts). Where
// it is missing, in local dev, a page served straight from the assets, or mm-api not answering the Worker, the island
// fetches it, and any code books. What a referral earns, as ops set it
// (docs/decisions/0107-referral-rewards-in-the-console.md), arrives the same way, onto <body>, and is fetched where it
// did not; every sentence that gives a count is built from it (useLandingData.ts).
//
// A valid invite is remembered in this browser for 30 days, so /book carries it if the friend leaves and books there
// later (site/src/lib/remembered-invite.ts). Outside production, ?state= opens each state directly (preview.ts).

import { capsLook } from "@maneman/ui/Caps";
import { CARD_HEIGHT, CARD_WIDTH } from "@rules/config/referral-cards.ts";
import { inviteReward, referral } from "../../content/referral.ts";
import type { Invite } from "../../lib/api.ts";
import { cardPath, HOUSE_CARD } from "../../lib/invite.ts";
import { fill } from "../../lib/text.ts";
import { IslandBoundary } from "../IslandBoundary.tsx";
import styles from "./Invite.module.css";
import { codeInPath } from "./page.ts";
import { Arrival, confirmation, PincodeAndForm } from "./PageParts.tsx";
import { useLandingData } from "./useLandingData.ts";
import { usePageFlow } from "./usePageFlow.ts";

interface Props {
  turnstileSiteKey: string;
  /** Outside production only: ?state= opens a state directly. */
  allowStateSwitch: boolean;
}

/** Who the invite is from: a partner, a client who agreed to be named, or no one named. */
function fromLine(name: string | null, partner: string | null): string {
  if (partner !== null) return fill(referral.arrival.partner, { partner });
  return name === null ? referral.arrival.unnamed : fill(referral.arrival.invited, { name });
}

/** The invite's heading, which for a code we do not know promises nothing the invite would have. */
function inviteHeading(invite: Invite | null): string {
  if (invite?.state === "unknown") return referral.arrival.unknown.title;
  return referral.arrival.title;
}

/** The invite's card, the referrer's own where they have one, and the house card where it will not load. */
function InviteCard(props: { invite: Invite | null }) {
  const src = props.invite === null ? HOUSE_CARD : cardPath(props.invite, codeInPath());
  const name = props.invite?.referrer_first_name ?? null;
  const { personal, house } = referral.arrival.card;
  return (
    <img
      class={styles.inviteCard}
      src={src}
      width={CARD_WIDTH}
      height={CARD_HEIGHT}
      // The page's largest first paint on a wide screen.
      fetchpriority="high"
      alt={src === HOUSE_CARD || name === null ? house : fill(personal, { name })}
      onError={(event) => {
        event.currentTarget.src = HOUSE_CARD;
        event.currentTarget.alt = house;
      }}
    />
  );
}

function LandingPage(props: Props) {
  const landing = useLandingData(true);
  const { invite } = landing;
  const reward = inviteReward(invite, landing.reward);
  const page = usePageFlow(true, props.allowStateSwitch);
  const name = invite?.referrer_first_name ?? null;
  // Only a valid invite carries its visits; the API books any other without them.
  const credits = invite?.state === "valid";
  const unknown = invite?.state === "unknown";

  const done = confirmation(page, name, reward);
  if (done !== null) return done;
  const offer = credits && reward !== null ? referral.arrival.offer(reward) : null;
  const discount = unknown ? null : (invite?.discount ?? null);
  const form = { name, invited: true, credits, reward, turnstileSiteKey: props.turnstileSiteKey };
  return (
    <Arrival aside={<InviteCard invite={invite} />}>
      {!unknown && <div class={capsLook(styles.from)}>{fromLine(name, invite?.partner ?? null)}</div>}
      <h1 ref={page.heading} tabIndex={-1} class={styles.title}>
        {inviteHeading(invite)}
      </h1>
      <div class={styles.offer}>
        {offer !== null && <p>{offer}</p>}
        {discount !== null && <p>{referral.arrival.discount(discount)}</p>}
        {unknown && (
          <p>
            <span class={styles.unknownTitle}>{referral.arrival.unknown.notice}</span>
            <span class={styles.unknownBody}>{referral.arrival.unknown.body(reward)}</span>
          </p>
        )}
      </div>
      <PincodeAndForm page={page} form={form} stage="all" />
    </Arrival>
  );
}

/** The island as the page mounts it: a throw while it draws is reported, and the way to us shown in its place. */
export default function Landing(props: Props) {
  return (
    <IslandBoundary>
      <LandingPage {...props} />
    </IslandBoundary>
  );
}
