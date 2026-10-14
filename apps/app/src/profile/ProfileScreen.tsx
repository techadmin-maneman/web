// The profile: where we come, what the client has agreed
// to, and their account: a change of number, support, and deletion.

import { LogOut } from "../login/index.ts";
import { useLiveLoad, whenLoaded } from "@maneman/ui/useLoad";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { profile } from "../content.ts";
import { Shell } from "../components/Shell.tsx";
import { useSession } from "../session.ts";
import { AddressSection } from "./AddressSection.tsx";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { ConsentList, type Consent } from "./ConsentList.tsx";
import { SessionsCard } from "./SessionsCard.tsx";
import { DataCard } from "./DataCard.tsx";
import { DeletionCard } from "./DeletionCard.tsx";
import { NumberChangeCard } from "./NumberChangeCard.tsx";
import { SupportCard } from "./SupportCard.tsx";
import styles from "./profile.module.css";

/** How often the profile is read again while it is open, and as soon as it comes back into view. */
const PROFILE_FRESH_MS = 5 * 60_000;

export function ProfileScreen({ onChanged }: { onChanged: () => void }) {
  const { loaded, refresh, retry } = useLiveLoad(api.profile, PROFILE_FRESH_MS);
  // A switch the API recorded, shown until the profile is next read, which then holds it.
  const [switched, setSwitched] = useState<readonly Consent[]>([]);
  useEffect(() => {
    setSwitched([]);
  }, [loaded]);

  /** The profile changed: read again, and Home told, since its card shows the address. */
  const changed = useCallback(() => {
    refresh();
    onChanged();
  }, [refresh, onChanged]);

  const { me } = useSession();
  return (
    <Shell header={{ kind: "back", title: me.name, to: "/", label: profile.back }} tab={null}>
      {whenLoaded(loaded, {
        loading: <Loading />,
        failed: <PageFailed onRetry={retry} />,
        loaded: (now) => (
          <div className={styles.page}>
            <AddressSection address={now.address} givenToOps={now.address_given_to_ops} onSaved={changed} />
            <ConsentList
              consents={now.consents.map((each) => switched.find((one) => one.purpose === each.purpose) ?? each)}
              onSwitched={(consent) => {
                setSwitched((was) => [...was.filter((one) => one.purpose !== consent.purpose), consent]);
              }}
            />
            <NumberChangeCard change={now.number_change} decided={now.number_change_decided} onChanged={refresh} />
            <SessionsCard />
            <SupportCard carePerson={now.care_person} hours={now.care_hours} />
            <DataCard grievances={now.grievances} onRaised={refresh} />
            <DeletionCard deletion={now.deletion} rejected={now.deletion_rejected} onRequested={refresh} />
            <LogOut className={styles.logout} />
          </div>
        ),
      })}
    </Shell>
  );
}
