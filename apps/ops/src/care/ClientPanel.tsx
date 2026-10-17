// The client beside their chat (docs/decisions/0140-the-client-panel.md): their next and last visit, free service
// visits and city, with a link to each part of their page where Care book, move or take payment.

import { Note } from "@maneman/ui/Note";
import { textLinkLook } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { api, isErased, type ClientVisit } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
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

export function ClientPanel({ personId }: { readonly personId: string }) {
  const load = useCallback(() => api.client(personId), [personId]);
  const [loaded] = useLoad(load);
  if (loaded.state !== "loaded" || isErased(loaded.value)) return null;
  const record = loaded.value;
  const [next] = record.visits.upcoming;
  const [last] = record.visits.past;
  return (
    <section className={styles.panel} aria-label={copy.title}>
      <dl className={styles.facts}>
        <dt>{copy.next}</dt>
        <dd>{next === undefined ? copy.none : visitLine(next)}</dd>
        <dt>{copy.last}</dt>
        <dd>{last === undefined ? copy.none : visitLine(last)}</dd>
        <dt>{copy.credits}</dt>
        <dd>{record.credits === null ? copy.none : record.credits.visits}</dd>
        <dt>{copy.city}</dt>
        <dd>{record.address?.city ?? copy.noAddress}</dd>
      </dl>
      <Note>
        {LINKS.map(([tab, label]) => (
          <OpsLink key={tab} className={textLinkLook({ className: styles.link })} to={clientPath(personId, tab)}>
            {label}
          </OpsLink>
        ))}
      </Note>
    </section>
  );
}
