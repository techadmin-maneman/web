// One past visit (board C9): its photographs, technician, duration and type,
// and the visit's own tax invoice beneath them (ADR 0056; the board has none).
// "What was done" arrives with the job sheet (P2-M4).

import { ICONS } from "@maneman/brand/icons";
import { fullDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, documentUrl, type VisitDetail } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { visits } from "../content.ts";
import { Shell } from "../home/Shell.tsx";
import { useLoad } from "../lib/useLoad.ts";
import { duration, visitName } from "../lib/visit.ts";
import { PhotoRow, type OpenPhoto } from "../photos/PhotoRow.tsx";
import { PhotoSheet } from "../photos/PhotoSheet.tsx";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import styles from "./visits.module.css";

function Fact({ name, value, numeric = false }: { name: string; value: string; numeric?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt>{name}</dt>
      <dd className={numeric ? styles.numeric : undefined}>{value}</dd>
    </div>
  );
}

/**
 * The visit's invoice, in one of its three states: here to open, still to come,
 * or never coming because the visit was free. Nothing is offered for a visit
 * FSM did not complete, which is billed by hand if it is billed at all.
 */
function Invoice({ visit }: { visit: VisitDetail }) {
  const copy = visits.detail.invoice;
  if (visit.status !== "completed") return null;
  if (visit.document_id === null) {
    return <p className={styles.invoiceLine}>{visit.invoice_expected ? copy.generating : copy.free}</p>;
  }
  return (
    <a className={styles.invoice} href={documentUrl(visit.document_id)} target="_blank" rel="noopener">
      <span>{copy.open}</span>
      <span className={styles.away}>{copy.newTab}</span>
      <Icon className={styles.invoiceIcon} d={ICONS.download} size={18} />
    </a>
  );
}

function Visit({ visit }: { visit: VisitDetail }) {
  const [open, setOpen] = useState<OpenPhoto | null>(null);
  const copy = visits.detail;
  const photographed = visit.photos.before.length > 0 || visit.photos.after.length > 0;
  return (
    <div className={styles.detail}>
      {photographed && (
        <section aria-labelledby="photographs">
          <h2 className={styles.label} id="photographs">
            {copy.photographs}
          </h2>
          <PhotoRow set={visit.photos} date={visit.date} onOpen={setOpen} />
        </section>
      )}
      <dl className={styles.facts}>
        {visit.technician !== null && <Fact name={copy.technician} value={visit.technician.name} />}
        {visit.duration_minutes !== null && (
          <Fact name={copy.duration} value={duration(visit.duration_minutes)} numeric />
        )}
        <Fact name={copy.type} value={visitName(visit.type)} />
      </dl>
      <Invoice visit={visit} />
      {open !== null && (
        <PhotoSheet
          photo={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

export function VisitScreen({ id }: { id: string }) {
  const [loaded, retry] = useLoad(useCallback(() => api.visit(id), [id]));
  const title = loaded.state === "loaded" ? fullDate(loaded.value.date) : visits.title;
  return (
    <Shell header={{ kind: "back", title, to: "/visits", label: visits.detail.back }} tab="/visits">
      {loaded.state === "loading" ? (
        <Loading />
      ) : loaded.state === "failed" ? (
        <PageFailed onRetry={retry} />
      ) : (
        <Visit visit={loaded.value} />
      )}
    </Shell>
  );
}
