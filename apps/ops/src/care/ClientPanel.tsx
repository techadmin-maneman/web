// The client beside their chat (docs/decisions/0140-the-client-panel.md): their next and last visit, free service
// visits, city and Care person; and a link to each part of their page where Care book, move or take payment.

import { buttonLook } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { api, isErased, type ClientVisit } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { care } from "../content/care.ts";
import { dispatch } from "../content/dispatch.ts";
import { clientPath, type ClientTab } from "../route.ts";
import styles from "./care.module.css";

const copy = care.panel;

/** "Thu 24 Sep, 12 pm · Service visit" */
function visitLine(visit: ClientVisit): string {
  const kind = visit.service ?? (visit.type === null ? "" : dispatch.typeNames[visit.type]);
  return copy.visit(`${shortDate(visit.date)}, ${indiaClock(visit.starts_at)}`, kind);
}

const LINKS: readonly (readonly [ClientTab, string])[] = [
  ["visits", copy.links.visits],
  ["payments", copy.links.payments],
  ["pieces", copy.links.pieces],
  ["consents", copy.links.consents],
];

/** A button to each part of the client's page, one beneath another. */
export function ClientLinks({ personId }: { readonly personId: string }) {
  return LINKS.map(([tab, label]) => (
    <OpsLink key={tab} className={buttonLook({ variant: "outline", size: "small" })} to={clientPath(personId, tab)}>
      {label}
    </OpsLink>
  ));
}

export function ClientPanel({ personId, carePerson }: { readonly personId: string; readonly carePerson: string }) {
  const load = useCallback(() => api.client(personId), [personId]);
  const [loaded] = useLoad(load);
  const record = loaded.state === "loaded" && !isErased(loaded.value) ? loaded.value : null;
  const [next] = record?.visits.upcoming ?? [];
  const [last] = record?.visits.past ?? [];
  // The Care person is the chat's own, so it stands while the client's record is read, or where it cannot be.
  return (
    <dl className={styles.facts} aria-label={copy.title}>
      {record !== null && (
        <>
          <dt>{copy.next}</dt>
          <dd>{next === undefined ? copy.none : visitLine(next)}</dd>
          <dt>{copy.last}</dt>
          <dd>{last === undefined ? copy.none : visitLine(last)}</dd>
          <dt>{copy.credits}</dt>
          <dd>{record.credits === null ? copy.none : record.credits.visits}</dd>
          <dt>{copy.city}</dt>
          <dd>{record.address?.city ?? copy.noAddress}</dd>
        </>
      )}
      <dt>{care.carePerson.label}</dt>
      <dd>{carePerson}</dd>
    </dl>
  );
}
