// One client's page (Ops Console, board B1's frame, with B2 and B3): who they
// are and the ways to reach them, then their visits, pieces, payments,
// consents, photographs or history. The board draws eight tabs; the six built
// are the ones the ops routes answer, and what the head is narrowed to is
// written down in docs/fidelity-method.md.
//
// The record is read once for the page. Visits, Payments and History are drawn
// from it, so moving between them costs no request. The photographs' opening
// is held here too, so leaving their tab and coming back is the same view and
// not a second entry in the log.

import { ICONS } from "@maneman/brand/icons";
import { longDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, type ClientRecord } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { clients } from "../content.ts";
import { whatsAppLink } from "../dispatch/job.ts";
import { phoneWords } from "../lib/phone.ts";
import type { ClientTab } from "../route.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./clients.module.css";
import { Consents } from "./Consents.tsx";
import { History, replacementDueOf } from "./History.tsx";
import { Payments } from "./Payments.tsx";
import { Photos, usePhotos } from "./Photos.tsx";
import { Pieces } from "./Pieces.tsx";
import { Visits } from "./Visits.tsx";

type Credits = ClientRecord["credits"];

const creditsOf = (credits: Credits) =>
  credits === null
    ? clients.unknown
    : clients.creditLine(credits.visits, credits.earliest_expiry === null ? null : longDate(credits.earliest_expiry));

function Head({ record, credits }: { record: ClientRecord; credits: Credits }) {
  const mobile = phoneWords(record.mobile);
  const meta = [
    { key: clients.meta.state, value: clients.states[record.state] },
    { key: clients.meta.credits, value: creditsOf(credits) },
  ];
  return (
    <div className={styles.head}>
      <div className={styles.headLine}>
        <h2 className={styles.name}>{record.name}</h2>
        <a
          className={styles.whatsapp}
          href={whatsAppLink(record.mobile)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={clients.whatsappLabel(record.name)}
        >
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={ICONS.whatsapp} />
          </svg>
          {clients.whatsapp}
        </a>
      </div>
      <dl className={styles.meta}>
        {meta.map((each) => (
          <div className={styles.metaItem} key={each.key}>
            <dt className={styles.metaKey}>{each.key}</dt>
            <dd className={styles.metaValue}>{each.value}</dd>
          </div>
        ))}
        <div className={styles.metaItem}>
          <dt className={styles.metaKey}>{clients.meta.replacement}</dt>
          <dd className={`${styles.metaValue ?? ""} ${styles.metaBrass ?? ""}`}>{replacementDueOf(record.history)}</dd>
        </div>
        <div className={styles.metaItem}>
          <dt className={styles.metaKey}>{clients.meta.mobile}</dt>
          <dd className={styles.metaValue}>
            <a
              className={styles.metaLink}
              href={`tel:${record.mobile}`}
              aria-label={clients.callLabel(record.name, mobile)}
            >
              {mobile}
            </a>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Tab({
  clientId,
  tab,
  record,
  credits,
  onCredits,
  photos,
}: {
  clientId: string;
  tab: ClientTab;
  record: ClientRecord;
  credits: Credits;
  onCredits: (credits: Credits) => void;
  photos: ReturnType<typeof usePhotos>;
}) {
  if (tab === "visits") return <Visits record={record} />;
  if (tab === "pieces") return <Pieces clientId={clientId} />;
  if (tab === "payments") {
    return <Payments clientId={clientId} payments={record.payments} credits={credits} onCredits={onCredits} />;
  }
  if (tab === "consents") return <Consents clientId={clientId} />;
  if (tab === "history") return <History history={record.history} />;
  return <Photos photos={photos} name={record.name} />;
}

export function ClientScreen({ clientId, tab }: { clientId: string; tab: ClientTab }) {
  const load = useCallback(() => api.client(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  const photos = usePhotos(clientId);
  // What the credit form last answered, which stands over the record read when the page opened.
  const [adjusted, setAdjusted] = useState<{ credits: Credits } | null>(null);

  return (
    <Shell section="/clients" title={clients.title} flush>
      {loaded.state === "loading" ? (
        <div className={styles.waiting}>
          <Loading />
        </div>
      ) : loaded.state === "failed" ? (
        <div className={styles.waiting}>
          <PanelFailed onRetry={retry} />
        </div>
      ) : (
        <div className={styles.client}>
          <Head record={loaded.value} credits={adjusted?.credits ?? loaded.value.credits} />
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
            <Tab
              clientId={clientId}
              tab={tab}
              record={loaded.value}
              credits={adjusted?.credits ?? loaded.value.credits}
              onCredits={(credits) => {
                setAdjusted({ credits });
              }}
              photos={photos}
            />
          </div>
        </div>
      )}
    </Shell>
  );
}
