// The profile (boards G1 and G2): where we come, what the client has agreed
// to, and their account: a change of number, support, and deletion.

import { Button } from "@maneman/ui/Button";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type Profile } from "../api.ts";
import { errors, profile } from "../content.ts";
import { Shell } from "../home/Shell.tsx";
import { LogOut } from "../login/LogOut.tsx";
import { useSession } from "../session.ts";
import { AddressSection } from "./AddressSection.tsx";
import { Loading } from "../states/Loading.tsx";
import { ConsentList } from "./ConsentList.tsx";
import { DataCard, DeletionCard, NumberChangeCard, SupportCard } from "./AccountCards.tsx";
import styles from "./profile.module.css";

export function ProfileScreen({ onChanged }: { onChanged: () => void }) {
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
  // Fetched again after a change without going back to Loading, so the page stays where the client is.
  function page(): ReactNode {
    if (loaded === null) return <Loading />;
    if (loaded === "failed") {
      return (
        <div className={`${styles.page} ${styles.failed}`} role="alert">
          <p>{errors.load}</p>
          <Button variant="outline" size="control" className={styles.secondary} onClick={() => void load()}>
            {errors.retry}
          </Button>
        </div>
      );
    }
    return (
      <div className={styles.page}>
        <AddressSection address={loaded.address} givenToOps={loaded.address_given_to_ops} onSaved={changed} />
        <ConsentList consents={loaded.consents} />
        <NumberChangeCard
          change={loaded.number_change}
          decided={loaded.number_change_decided}
          onChanged={() => void load()}
        />
        <SupportCard />
        <DataCard />
        <DeletionCard deletion={loaded.deletion} rejected={loaded.deletion_rejected} onRequested={() => void load()} />
        <LogOut className={styles.logout} />
      </div>
    );
  }

  return (
    <Shell header={{ kind: "back", title: me.name, to: "/", label: profile.back }} tab={null}>
      {page()}
    </Shell>
  );
}
