// The profile's own pages, each opened from its list (design/client-redesign, the address, privacy and account
// screens): the address and its access notes, what the client has agreed to, and the account's number, sign-ins, data
// and deletion. Each reads the profile itself, so it opens straight from a link too.

import { Loading } from "@maneman/ui/States";
import { whenLoaded } from "@maneman/ui/useLoad";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Profile } from "../api.ts";
import { profile, profilePages } from "../content.ts";
import { PageFailed } from "../frame/PageFailed.tsx";
import { Shell } from "../frame/Shell.tsx";
import { lawOf } from "../lib/counts.ts";
import { useSession } from "../session.ts";
import { AddressSection } from "./AddressSection.tsx";
import { ConsentList, type Consent } from "./ConsentList.tsx";
import { DataCard } from "./DataCard.tsx";
import { DeletionCard } from "./DeletionCard.tsx";
import { NumberChangeCard } from "./NumberChangeCard.tsx";
import { SessionsCard } from "./SessionsCard.tsx";
import { useProfile } from "./useProfile.ts";
import styles from "./profile-screen.module.css";

/** A page under the profile: its title, Back to the list, and its body once the profile has answered. */
function ProfilePage({
  title,
  children,
}: {
  title: string;
  children: (now: Profile, refresh: () => void) => ReactNode;
}) {
  const { loaded, refresh, retry } = useProfile();
  return (
    <Shell header={{ kind: "back", title, to: "/profile", label: profile.back }} tab={null}>
      {whenLoaded(loaded, {
        loading: <Loading />,
        failed: <PageFailed onRetry={retry} />,
        loaded: (now) => <div className={styles.page}>{children(now, refresh)}</div>,
      })}
    </Shell>
  );
}

export function AddressScreen() {
  const session = useSession();
  return (
    <ProfilePage title={profilePages.address}>
      {(now, refresh) => (
        <>
          <p className={styles.lede}>{profilePages.addressLede}</p>
          <AddressSection
            address={now.address}
            givenToOps={now.address_given_to_ops}
            pinned={now.address_pinned}
            onSaved={() => {
              // Home's next-visit card shows the address too.
              refresh();
              session.refresh();
            }}
          />
        </>
      )}
    </ProfilePage>
  );
}

export function PrivacyScreen() {
  return <ProfilePage title={profilePages.privacy}>{(now) => <Consents consents={now.consents} />}</ProfilePage>;
}

/** The consents, with a switch the API recorded shown until the profile is next read, which then holds it. */
function Consents({ consents }: { consents: readonly Consent[] }) {
  const [switched, setSwitched] = useState<readonly Consent[]>([]);
  useEffect(() => {
    setSwitched([]);
  }, [consents]);
  const onSwitched = useCallback((consent: Consent) => {
    setSwitched((was) => [...was.filter((one) => one.purpose !== consent.purpose), consent]);
  }, []);
  return (
    <ConsentList
      consents={consents.map((each) => switched.find((one) => one.purpose === each.purpose) ?? each)}
      onSwitched={onSwitched}
    />
  );
}

export function AccountScreen() {
  const law = lawOf(useSession().me);
  return (
    <ProfilePage title={profilePages.account}>
      {(now, refresh) => (
        <>
          <NumberChangeCard change={now.number_change} decided={now.number_change_decided} onChanged={refresh} />
          <SessionsCard />
          <DataCard grievances={now.grievances} answerDays={law?.grievance_days ?? null} onRaised={refresh} />
          <DeletionCard
            deletion={now.deletion}
            rejected={now.deletion_rejected}
            law={law === null ? null : { days: law.deletion_days, years: law.invoices_kept_years }}
            onRequested={refresh}
          />
        </>
      )}
    </ProfilePage>
  );
}
