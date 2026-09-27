// One visit. Past (board C9): its photographs, technician, duration and type,
// what was done, and the visit's own tax invoice beneath them (ADR 0056; the
// board has none). Still to come, or under way: its card as Home draws its next
// visit (board B1), with Reschedule and Add a note. A visit that is not the
// client's says so, rather than offering to try again.

import { ICONS } from "@maneman/brand/icons";
import { fullDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, documentUrl, type VisitDetail } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { messages, visits } from "../content.ts";
import { Shell } from "../home/Shell.tsx";
import { VisitCard } from "../home/VisitCard.tsx";
import { apiNow } from "../lib/clock.ts";
import { useLoad } from "../lib/useLoad.ts";
import { duration, invoiceState, visitName } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { PhotoRow, type OpenPhoto } from "../photos/PhotoRow.tsx";
import { PhotoSheet } from "../photos/PhotoSheet.tsx";
import { Loading } from "../states/Loading.tsx";
import { NotFound } from "../states/NotFound.tsx";
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

/** The visit's invoice: here to open, still to come, late, or never coming because the visit was free. */
function Invoice({ visit }: { visit: VisitDetail }) {
  const copy = visits.detail.invoice;
  const state = invoiceState(visit, apiNow());
  switch (state) {
    case "none":
      return null;
    case "free":
      return <p className={styles.invoiceLine}>{copy.free}</p>;
    case "generating":
      return <p className={styles.invoiceLine}>{copy.generating}</p>;
    case "credit":
      return <p className={styles.invoiceLine}>{copy.credit}</p>;
    case "checking": {
      const message = messages.lateInvoice(visitName(visit.type), shortDate(visit.date));
      return (
        <div className={styles.late}>
          <p className={styles.invoiceLine}>{copy.checking}</p>
          <a className={styles.message} href={whatsappWith(message)} rel="noopener">
            {copy.message}
          </a>
        </div>
      );
    }
    case "late": {
      const message = messages.lateInvoice(visitName(visit.type), shortDate(visit.date));
      return (
        <div className={styles.late}>
          <p className={styles.invoiceLine}>{copy.late}</p>
          <a className={styles.message} href={whatsappWith(message)} rel="noopener">
            {copy.message}
          </a>
        </div>
      );
    }
    case "open":
      return visit.document_id === null ? null : (
        <a className={styles.invoice} href={documentUrl(visit.document_id)} target="_blank" rel="noopener">
          <span>{copy.open}</span>
          <span className={styles.away}>{copy.newTab}</span>
          <Icon className={styles.invoiceIcon} d={ICONS.download} size={18} />
        </a>
      );
  }
}

/** A visit the client was not home for (LIFE-07): that we came and waited, and what was ruled. */
function NoShow({ note }: { note: NonNullable<VisitDetail["no_show"]> }) {
  const copy = visits.detail.noShow;
  return (
    <section className={styles.noShow} aria-labelledby="no-show">
      <h2 className={styles.label} id="no-show">
        {copy.label}
      </h2>
      <p className={styles.noShowLine}>{copy.line(note.waited_minutes)}</p>
      <p className={styles.noShowLine}>{copy.decision[note.decision]}</p>
    </section>
  );
}

function PastVisit({ visit }: { visit: VisitDetail }) {
  const [open, setOpen] = useState<OpenPhoto | null>(null);
  const copy = visits.detail;
  const photographed = visit.photos.before.length > 0 || visit.photos.after.length > 0;
  return (
    <div className={styles.detail}>
      {visit.no_show !== null && <NoShow note={visit.no_show} />}
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
        {visit.what_was_done !== null && visit.what_was_done.length > 0 && (
          <div className={styles.done}>
            <dt>{copy.done}</dt>
            <dd>{copy.doneLine(visit.what_was_done)}</dd>
          </div>
        )}
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

function Visit({ visit }: { visit: VisitDetail }) {
  if (visit.stage === null) return <PastVisit visit={visit} />;
  return (
    <div className={styles.coming}>
      <VisitCard visit={visit} />
    </div>
  );
}

export function VisitScreen({ id }: { id: string }) {
  const [loaded, retry] = useLoad(useCallback(() => api.visit(id), [id]));
  const title = loaded.state === "loaded" ? fullDate(loaded.value.date) : visits.title;
  return (
    <Shell header={{ kind: "back", title, to: "/visits", label: visits.detail.back }} tab="/visits">
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && loaded.notFound && (
        <NotFound message={visits.notFound} back={visits.detail.back} to="/visits" />
      )}
      {loaded.state === "failed" && !loaded.notFound && <PageFailed onRetry={retry} />}
      {loaded.state === "loaded" && <Visit visit={loaded.value} />}
    </Shell>
  );
}
