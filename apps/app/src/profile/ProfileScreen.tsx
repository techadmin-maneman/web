// The profile (boards G1 and G2): where we come, what the client has agreed
// to, and their account: a change of number, support, and deletion.

import { useCallback, useEffect, useState } from "react";
import { api, type Profile } from "../api.ts";
import { errors, profile } from "../content.ts";
import { Shell } from "../home/Shell.tsx";
import { useSession } from "../session.ts";
import { AddressSection } from "./AddressSection.tsx";
import { Loading } from "../states/Loading.tsx";
import { ConsentList } from "./ConsentList.tsx";
import { DeletionCard, NumberChangeCard, SupportCard } from "./AccountCards.tsx";
import styles from "./profile.module.css";

export function ProfileScreen({ onLogout, onChanged }: { onLogout: () => void; onChanged: () => void }) {
  const [loaded, setLoaded] = useState<Profile | "failed" | null>(null);

  const load = useCallback(async () => {
    const answer = await api.profile();
    setLoaded(answer.ok ? answer.body : "failed");
  }, []);

  /** The profile changed: fetched again, and Home told, since its card shows the address. */
  const changed = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const { me } = useSession();
  return (
    <Shell header={{ kind: "back", title: me.name, to: "/", label: profile.back }} tab={null}>
      {loaded === null ? (
        <Loading />
      ) : loaded === "failed" ? (
        <div className={`${styles.page} ${styles.failed}`} role="alert">
          <p>{errors.load}</p>
          <button className={styles.secondary} type="button" onClick={() => void load()}>
            {errors.retry}
          </button>
        </div>
      ) : (
        <div className={styles.page}>
          <AddressSection address={loaded.address} onSaved={changed} />
          <ConsentList consents={loaded.consents} />
          <NumberChangeCard change={loaded.number_change} onChanged={() => void load()} />
          <SupportCard />
          <DeletionCard deletion={loaded.deletion} onRequested={() => void load()} />
          <button className={styles.logout} type="button" onClick={onLogout}>
            {profile.logout}
          </button>
        </div>
      )}
    </Shell>
  );
}
