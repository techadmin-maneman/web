// The profile, under the client's initials: who they are, then a list of what is theirs (their hair system, payments
// and invoices, issues, address, privacy, help, the account) and signing out (design/client-redesign, the profile
// screen). Each row opens its own page; help opens WhatsApp.

import { CLIENT_ICONS, GLYPHS } from "@maneman/brand/icons";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { TextLink } from "@maneman/ui/TextLink";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { LogOut } from "../login/index.ts";
import { LEGAL_URLS, profile, profileMenu, whatsapp } from "../content.ts";
import { Shell } from "../frame/Shell.tsx";
import { openIssues } from "../lib/counts.ts";
import type { Profile } from "../api.ts";
import { useSession } from "../session.ts";
import { useProfile } from "./useProfile.ts";
import styles from "./profile-screen.module.css";

export function ProfileScreen() {
  const { me } = useSession();
  const { loaded } = useProfile();
  const now = loaded.state === "loaded" ? loaded.value : null;
  const legal = LEGAL_URLS[import.meta.env.MM_ENV];
  return (
    <Shell header={{ kind: "back", to: "/", label: profile.back }} tab={null}>
      <div className={styles.page}>
        <div className={styles.who}>
          <span className={styles.initials} aria-hidden="true">
            {me.initials}
          </span>
          <div>
            <h1 className={styles.name}>{me.name}</h1>
            {now !== null && <p className={styles.mobile}>{now.mobile}</p>}
          </div>
        </div>
        <ProfileRows now={now} />
        <div className={styles.signOut}>
          <LogOut />
        </div>
        <p className={styles.legal}>
          <TextLink href={legal.terms} newTab>
            {profileMenu.terms}
          </TextLink>
          {" · "}
          <TextLink href={legal.privacy} newTab>
            {profileMenu.privacyPolicy}
          </TextLink>
        </p>
      </div>
    </Shell>
  );
}

/** What is the client's, a row each; before the first fit, only what a lead has. */
function ProfileRows({ now }: { now: Profile | null }) {
  const { me } = useSession();
  const fitted = me.state === "fitted";
  const copy = profile.support;
  return (
    <ListRows>
      {fitted && me.hair_system !== null && (
        <ListRow
          icon={CLIENT_ICONS.layers}
          title={profileMenu.hairSystem}
          meta={profileMenu.hairSystemMeta(me.hair_system.name)}
          to="/hair-system"
          chevron
        />
      )}
      {fitted && (
        <ListRow
          icon={CLIENT_ICONS.receipt}
          title={profileMenu.payments}
          meta={profileMenu.paymentsMeta}
          to="/profile/payments"
          chevron
        />
      )}
      <ListRow
        icon={CLIENT_ICONS.flag}
        title={profileMenu.issues}
        meta={openIssues(me) > 0 ? profileMenu.issuesMeta(openIssues(me), openIssues(me)) : profileMenu.issuesNone}
        to="/visits/issues"
        chevron
      />
      <ListRow
        icon={GLYPHS.pin}
        title={profileMenu.address}
        meta={now?.address?.line1 ?? (now === null ? undefined : profileMenu.addressNone)}
        to="/profile/address"
        chevron
      />
      <ListRow
        icon={CLIENT_ICONS.lock}
        title={profileMenu.privacy}
        meta={profileMenu.privacyMeta}
        to="/profile/privacy"
        chevron
      />
      <ListRow
        icon={CLIENT_ICONS.chat}
        title={profileMenu.help}
        meta={
          now === null
            ? undefined
            : copy.hint(
                copy.within(now.care_hours.first_reply),
                copy.hours(copy.hour(now.care_hours.opens), copy.hour(now.care_hours.closes)),
              )
        }
        href={whatsappChat(whatsapp.number)}
        chevron
      />
      <ListRow
        icon={CLIENT_ICONS.user}
        title={profileMenu.account}
        meta={profileMenu.accountMeta}
        to="/profile/account"
        chevron
      />
    </ListRows>
  );
}
