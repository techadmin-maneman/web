// One client's page (Ops Console, boards B2 and B3): who they are, then their
// photographs or their consents. The board draws eight tabs; these are the two
// the ops routes answer, and what it heads the page with is narrowed the same
// way (docs/fidelity-method.md).

import { longDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { api, type ClientRecord } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { clients } from "../content.ts";
import type { ClientTab } from "../route.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./clients.module.css";
import { Consents } from "./Consents.tsx";
import { Photos } from "./Photos.tsx";

const creditsOf = (credits: ClientRecord["credits"]) =>
  credits === null
    ? clients.unknown
    : clients.credits(credits.visits, credits.earliest_expiry === null ? null : longDate(credits.earliest_expiry));

function Head({ record }: { record: ClientRecord }) {
  return (
    <div className={styles.head}>
      <h2 className={styles.name}>{record.name}</h2>
      <dl className={styles.meta}>
        <div className={styles.metaItem}>
          <dt className={styles.metaKey}>{clients.meta.state}</dt>
          <dd className={styles.metaValue}>{clients.states[record.state]}</dd>
        </div>
        <div className={styles.metaItem}>
          <dt className={styles.metaKey}>{clients.meta.credits}</dt>
          <dd className={styles.metaValue}>{creditsOf(record.credits)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ClientScreen({ clientId, tab }: { clientId: string; tab: ClientTab }) {
  const load = useCallback(() => api.client(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);

  return (
    <Shell section="/clients" title={clients.title}>
      {loaded.state === "loading" ? (
        <Loading />
      ) : loaded.state === "failed" ? (
        <PanelFailed onRetry={retry} />
      ) : (
        <div className={styles.client}>
          <Head record={loaded.value} />
          <nav className={styles.tabs} aria-label={loaded.value.name}>
            {clients.tabs.map((each) => (
              <OpsLink
                key={each.tab}
                className={styles.tab}
                to={`/clients/${clientId}/${each.tab}`}
                current={each.tab === tab}
              >
                {each.label}
              </OpsLink>
            ))}
          </nav>
          <div className={styles.panel}>
            {tab === "consents" ? (
              <Consents clientId={clientId} />
            ) : (
              <Photos clientId={clientId} name={loaded.value.name} />
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
