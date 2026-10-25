// The client's consents, read only: ops can never grant one (src/routes/ops/client-consents.ts). The fourth column is
// where each was given (docs/decisions/0094-where-a-consent-was-given.md). Beneath them, erasing the client, for a
// request made outside the app.

import { classes } from "@maneman/ui/classes";
import { TextLink } from "@maneman/ui/TextLink";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { type Consent } from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import shared from "./clients.module.css";
import styles from "./consents.module.css";
import { Erase } from "./Erase.tsx";
import { clientsApi } from "./clients-api.ts";

const copy = clients.consents;

/** The table's columns, in the board's order. */
const COLUMNS = ["purpose", "state", "date", "source"] as const;

/** A visit's own photographs are part of the service and need no consent, so their row would only mislead. */
const UNASKED: ReadonlySet<Consent["purpose"]> = new Set(["photos_own_record"]);

/** Where the consent was given; the board's dash for one never given, and "Not recorded" where nothing says. */
function sourceOf(consent: Consent): string {
  if (consent.state === "not_given") return clients.unknown;
  if (consent.source === null) return copy.notRecorded;
  return copy.sources[consent.source];
}

/** The board marks a withdrawn consent in oxblood and one never given in the quiet ink. */
const TONE: Readonly<Record<Consent["state"], string>> = {
  given: "",
  withdrawn: styles.withdrawn ?? "",
  not_given: styles.quiet ?? "",
};

function ConsentRow({ consent }: { consent: Consent }) {
  return (
    <tr>
      <th scope="row" className={styles.purpose}>
        {copy.purposes[consent.purpose]}
      </th>
      <td className={classes(styles.state, TONE[consent.state])}>{copy.states[consent.state]}</td>
      <td className={styles.date}>{consent.at === null ? clients.unknown : longDate(consent.at)}</td>
      <td className={styles.source}>{sourceOf(consent)}</td>
    </tr>
  );
}

/** Everything held about the client, as their app downloads it, for Care to send them when they ask. */
function ExportData({ clientId }: { clientId: string }) {
  if (!useAccess().mayCall("GET /api/clients/{id}/export.html")) return null;
  return (
    <p className={styles.deletion}>
      <TextLink href={`/api/clients/${clientId}/export.html`}>{copy.exportData}</TextLink>
    </p>
  );
}

export function Consents({ clientId, name, onErased }: { clientId: string; name: string; onErased: () => void }) {
  const load = useCallback(() => clientsApi.clientConsents(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const { consents, deletion } = loaded.value;
  return (
    <section className={styles.consents} aria-label={copy.title}>
      <Table className={shared.table}>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className={styles[column]}>
                {copy.columns[column]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {consents
            .filter((consent) => !UNASKED.has(consent.purpose))
            .map((consent) => (
              <ConsentRow key={consent.purpose} consent={consent} />
            ))}
        </tbody>
      </Table>
      {deletion !== null && (
        <p className={styles.deletion}>{copy.deletion[deletion.state](longDate(deletion.requested_at))}</p>
      )}
      <ExportData clientId={clientId} />
      <Erase clientId={clientId} name={name} requested={deletion?.state === "requested"} onErased={onErased} />
    </section>
  );
}
