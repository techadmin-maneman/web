// The right of a client's page: four figures at a glance, the address their visits go to, staff's notes, and their
// Care person. Below a desk's width it stands beneath the tabs.

import { FigureGrid, type FigureTone } from "@maneman/ui/FigureGrid";
import { Panel } from "@maneman/ui/Panel";
import { todayInIndia } from "@maneman/web-kit/dates";
import { apiNow } from "@maneman/web-kit/clock";
import { rupees } from "@maneman/web-kit/money";
import type { ClientRecord } from "../api.ts";
import { CarePersonLine } from "../care/index.ts";
import { clients } from "../content.ts";
import styles from "./client-screen.module.css";
import { replacementDueOf } from "./History.tsx";
import { paidToDate } from "./Payments.tsx";
import { StaffNotes } from "./StaffNotes.tsx";
import { VisitAddress } from "./VisitAddress.tsx";

const copy = clients.glance;

/** A replacement past its day in the error's tone; one to come in brass; none, plain. */
function replaceTone(history: ClientRecord["history"]): FigureTone {
  const due = history.replacement_due;
  if (due === null) return "plain";
  return due.on < todayInIndia(apiNow()) ? "warning" : "attention";
}

function Glance({ record, credits }: { record: ClientRecord; credits: ClientRecord["credits"] }) {
  return (
    <Panel titleId="client-glance" title={copy.title}>
      <FigureGrid
        figures={[
          { label: copy.paid, value: rupees(paidToDate(record.payments)) },
          { label: copy.visits, value: String(record.history.visits) },
          {
            label: copy.replaceBy,
            value: replacementDueOf(record.history, record.state === "fitted"),
            tone: replaceTone(record.history),
          },
          { label: copy.freeVisits, value: String(credits?.visits ?? 0) },
        ]}
      />
    </Panel>
  );
}

export function ClientAside(props: {
  readonly clientId: string;
  readonly record: ClientRecord;
  readonly credits: ClientRecord["credits"];
  readonly address: ClientRecord["address"];
  readonly onAddress: (address: NonNullable<ClientRecord["address"]>) => void;
}) {
  const { clientId, record } = props;
  return (
    <aside className={styles.aside} aria-label={record.name}>
      <Glance record={record} credits={props.credits} />
      <VisitAddress clientId={clientId} address={props.address} onAddress={props.onAddress} />
      <StaffNotes clientId={clientId} />
      <CarePersonLine clientId={clientId} mobile={record.mobile} />
    </aside>
  );
}
