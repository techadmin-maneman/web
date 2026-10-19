// One visit. Past: its photographs, technician, duration and type,
// what was done, and the visit's own tax invoice beneath them (ADR 0056; the
// board has none). A visit the client was not home for says what ops ruled and
// what a charge took, and offers the charge's dispute (ADR 0096); a cancelled
// one says it was cancelled. Not yet closed: its card as Home draws its
// next visit, with Reschedule and Add a note until it begins. A
// visit that is not the client's says so, rather than offering to try again.

import { DisputeSheet, ProblemLink } from "../booking/index.ts";
import { VisitCard } from "../home/index.ts";
import { LINKS_FRESH_MS, PhotoRow, type OpenPhoto, PhotoSheet, type Relink, useRelink } from "../photos/index.ts";
import { capsLook } from "@maneman/ui/Caps";
import { ICONS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { useLiveLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useEffect, useState } from "react";
import { api, documentUrl, receiptUrl, type VisitDetail } from "../api.ts";
import { messages, ONE_VISIT, payments, visitLength, visits } from "../content.ts";
import { AddToCalendar } from "../components/AddToCalendar.tsx";
import { OpenDocument } from "../components/OpenDocument.tsx";
import { Shell } from "../components/Shell.tsx";
import { apiNow } from "@maneman/web-kit/clock";
import { invoiceState, oneVisitOf, visitName, visitTitle } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { firstNameOf } from "@rules/lib/names.ts";
import { Loading } from "../states/Loading.tsx";
import { NotFound } from "../states/NotFound.tsx";
import { go } from "../route.ts";
import { PageFailed } from "../states/PageFailed.tsx";
import shared from "./visits.module.css";
import styles from "./visit-screen.module.css";

function Fact({ name, value, numeric = false }: { name: string; value: string; numeric?: boolean }) {
  return (
    <div className={shared.fact}>
      <dt>{name}</dt>
      <dd className={numeric ? shared.numeric : undefined}>{value}</dd>
    </div>
  );
}

/** An invoice not here when it should be, with a way to ask us for it on WhatsApp. */
function AskForInvoice({ visit, line }: { visit: VisitDetail; line: string }) {
  const message = messages.lateInvoice(visitName(visit.type), shortDate(visit.date));
  return (
    <div className={styles.late}>
      <p className={styles.invoiceLine}>{line}</p>
      <ButtonLink variant="outline" size="small" className={styles.message} href={whatsappWith(message)} rel="noopener">
        {visits.detail.invoice.message}
      </ButtonLink>
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
    case "checking":
    case "delayed":
    case "late":
      return <AskForInvoice visit={visit} line={copy[state]} />;
    case "open":
      return visit.document_id === null ? null : (
        <OpenDocument url={documentUrl(visit.document_id)} notReady={payments.unavailable.invoice}>
          <span>{copy.open}</span>
          <VisuallyHidden>{copy.newTab}</VisuallyHidden>
          <Icon className={styles.invoiceIcon} d={ICONS.download} size="sm" />
        </OpenDocument>
      );
  }
}

type NoShowNote = NonNullable<VisitDetail["no_show"]>;

/** The ruling, and what a charge took where the ruling recorded it. */
function rulingOf(note: NoShowNote): string {
  const copy = visits.detail.noShow;
  if (note.charge === null) return copy.decision[note.decision];
  if (note.charge.kept > 0) return copy.kept(rupees(note.charge.kept));
  return note.charge.credit_spent ? copy.creditSpent : copy.decision.charged;
}

/**
 * A visit the client was not home for: that we came and waited, what was ruled, and where a dispute of
 * the charge stands, the way to raise one, or when the time to raise one ended.
 */
function NoShow({ visitId, note, onDisputed }: { visitId: string; note: NoShowNote; onDisputed: () => void }) {
  const [disputing, setDisputing] = useState(false);
  const copy = visits.detail.noShow;
  return (
    <section className={styles.noShow} aria-labelledby="no-show">
      <h2 className={capsLook(shared.label)} id="no-show">
        {copy.label}
      </h2>
      <p className={styles.noShowLine}>{copy.line(note.waited_minutes)}</p>
      {/* A refund undoes the charge, so after one only its outcome is said. */}
      {note.dispute !== "refunded" && <p className={styles.noShowLine}>{rulingOf(note)}</p>}
      {note.dispute !== null && <p className={styles.noShowLine}>{copy.disputed[note.dispute]}</p>}
      {note.dispute_closed_at !== null && (
        <p className={styles.noShowLine}>{copy.disputeClosed(shortDate(indiaDate(note.dispute_closed_at)))}</p>
      )}
      {note.disputable && (
        <Button
          variant="outline"
          size="control"
          className={styles.dispute}
          onClick={() => {
            setDisputing(true);
          }}
        >
          {copy.dispute}
        </Button>
      )}
      {disputing && (
        <DisputeSheet
          visitId={visitId}
          onClose={(disputed) => {
            setDisputing(false);
            if (disputed) onDisputed();
          }}
        />
      )}
    </section>
  );
}

function PastVisit({ visit, onChanged, relink }: { visit: VisitDetail; onChanged: () => void; relink: Relink }) {
  const [open, setOpen] = useState<OpenPhoto | null>(null);
  const copy = visits.detail;
  const photographed = visit.photos.before.length > 0 || visit.photos.after.length > 0;
  return (
    <div className={shared.detail}>
      {visit.status === "cancelled" && <p className={styles.cancelled}>{copy.cancelled}</p>}
      {visit.no_show !== null && <NoShow visitId={visit.id} note={visit.no_show} onDisputed={onChanged} />}
      {photographed && (
        <section aria-labelledby="photographs">
          <h2 className={capsLook(shared.label)} id="photographs">
            {copy.photographs}
          </h2>
          <PhotoRow set={visit.photos} date={visit.date} onOpen={setOpen} relink={relink} />
        </section>
      )}
      <dl className={shared.facts}>
        {visit.technician !== null && <Fact name={copy.technician} value={visit.technician.name} />}
        {visit.duration_minutes !== null && visit.duration_minutes > 0 && (
          <Fact name={copy.duration} value={visitLength(visit.duration_minutes)} numeric />
        )}
        <Fact name={copy.type} value={visitTitle(visit)} />
        {visit.paid !== null && <Paid paid={visit.paid} />}
        {visit.what_was_done !== null && visit.what_was_done.length > 0 && (
          <div className={styles.done}>
            <dt>{copy.done}</dt>
            <dd>{copy.doneLine(visit.what_was_done)}</dd>
          </div>
        )}
      </dl>
      <Receipt paid={visit.paid} />
      <Invoice visit={visit} />
      {visit.status === "completed" && (
        <ProblemLink about={{ about: "visit", visitId: visit.id }} className={styles.dispute} />
      )}
      {open !== null && (
        <PhotoSheet
          photo={open}
          relink={relink}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

/** What was paid, on a row as every other fact is. Its receipt is a document beside the invoice. */
function Paid({ paid }: { paid: NonNullable<VisitDetail["paid"]> }) {
  return (
    <div className={shared.fact}>
      <dt>{visits.detail.paid}</dt>
      <dd className={shared.numeric}>{rupees(paid.amount)}</dd>
    </div>
  );
}

/** The payment's receipt, opened as the invoice is, once Books has recorded the payment. */
function Receipt({ paid }: { paid: VisitDetail["paid"] }) {
  const receipt = paid?.receipt ?? null;
  if (receipt === null) return null;
  return (
    <OpenDocument url={receiptUrl(receipt)} notReady={payments.unavailable.receipt}>
      <span>{visits.detail.receipt}</span>
      <VisuallyHidden>{visits.detail.invoice.newTab}</VisuallyHidden>
      <Icon className={styles.invoiceIcon} d={ICONS.download} size="sm" />
    </OpenDocument>
  );
}

function Visit({ visit, onChanged, relink }: { visit: VisitDetail; onChanged: () => void; relink: Relink }) {
  if (visit.stage === null) return <PastVisit visit={visit} onChanged={onChanged} relink={relink} />;
  return (
    <div className={styles.coming}>
      <VisitCard
        visit={visit}
        onChanged={(change) => {
          if (change === "cancelled") go("/visits");
          else onChanged();
        }}
      />
      {visit.stage === "booked" && (
        <div className={styles.calendar}>
          <AddToCalendar
            visit={{
              id: visit.id,
              starts_at: visit.starts_at,
              ends_at: visit.ends_at,
              arrives_by: visit.arrives_by,
              name: oneVisitOf(visit) === null ? visitName(visit.type) : ONE_VISIT,
              technician: visit.technician === null ? null : firstNameOf(visit.technician.name),
            }}
          />
        </div>
      )}
    </div>
  );
}

/** A visit to come says its day on its card, so its page is named by what it is; a past one by its day. */
const titleOf = (visit: VisitDetail): string => (visit.stage === null ? fullDate(visit.date) : visitName(visit.type));

export function VisitScreen({ id }: { id: string }) {
  const { loaded, refresh, retry } = useLiveLoad(
    useCallback(() => api.visit(id), [id]),
    LINKS_FRESH_MS,
  );
  const relink = useRelink(refresh);
  const [changed, setChanged] = useState(false);
  // A move read again at its new time; a charged move cancels this visit for a new one, which the list shows.
  const replaced = changed && loaded.state === "loaded" && loaded.value.status === "cancelled";
  useEffect(() => {
    if (replaced) go("/visits");
  }, [replaced]);
  const title = loaded.state === "loaded" ? titleOf(loaded.value) : visits.title;
  return (
    <Shell header={{ kind: "back", title, to: "/visits", label: visits.detail.back }} tab="/visits">
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && loaded.notFound && (
        <NotFound message={visits.notFound} back={visits.detail.back} to="/visits" />
      )}
      {loaded.state === "failed" && !loaded.notFound && <PageFailed onRetry={retry} />}
      {loaded.state === "loaded" && (
        <Visit
          visit={loaded.value}
          relink={relink}
          onChanged={() => {
            setChanged(true);
            refresh();
          }}
        />
      )}
    </Shell>
  );
}
