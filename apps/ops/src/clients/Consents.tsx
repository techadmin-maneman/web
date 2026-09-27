// Board B3: what the client has agreed to, read only. Ops can never grant a
// consent, and no route here would let them (src/routes/ops-clients.ts). The
// board's fourth column is the source; nothing records one, so it carries the
// notice version the client saw instead (docs/fidelity-method.md).

import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { api, type Consent } from "../api.ts";
import { clients } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./clients.module.css";

const copy = clients.consents;

/**
 * The notice the consent was given on, less the purpose the row already names: "photos-referral-cards-v2" → "v2",
 * and a consent given by booking a visit (ADR 0080) "photos-referral-cards-booking-v1" → "booking-v1".
 */
function noticeOf(consent: Consent): string {
  if (consent.notice_version === null) return clients.unknown;
  const purpose = `${consent.purpose.replaceAll("_", "-")}-`;
  return consent.notice_version.replace(purpose, "");
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
      <td className={`${styles.state ?? ""} ${TONE[consent.state]}`}>{copy.states[consent.state]}</td>
      <td className={styles.date}>{consent.at === null ? clients.unknown : longDate(consent.at)}</td>
      <td className={styles.notice}>{noticeOf(consent)}</td>
    </tr>
  );
}

export function Consents({ clientId }: { clientId: string }) {
  const load = useCallback(() => api.clientConsents(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const { consents, deletion } = loaded.value;
  return (
    <section className={styles.consents} aria-label={copy.title}>
      <Table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.purpose}>
              {copy.columns[0]}
            </th>
            <th scope="col" className={styles.state}>
              {copy.columns[1]}
            </th>
            <th scope="col" className={styles.date}>
              {copy.columns[2]}
            </th>
            <th scope="col" className={styles.notice}>
              {copy.columns[3]}
            </th>
          </tr>
        </thead>
        <tbody>
          {consents.map((consent) => (
            <ConsentRow key={consent.purpose} consent={consent} />
          ))}
        </tbody>
      </Table>
      {deletion !== null && (
        <p className={styles.deletion}>{copy.deletion[deletion.state](longDate(deletion.requested_at))}</p>
      )}
      <p className={styles.note}>{copy.note}</p>
    </section>
  );
}
