// One visit. Past: what it was under its date, its photographs and who sees them, its sign-off and a first fit's
// guarantee, technician, time taken and what was paid, what was done, the client's rating of it, and the visit's receipt
// and tax invoice beneath them (ADR 0056). A visit the client was not home for says so in red, then what ops ruled and
// what a charge took, and offers the charge's dispute (ADR 0096); a cancelled one says it was cancelled. Not yet closed: its card as Home draws its
// next visit, with Reschedule and Add a note until it begins, and its photographs once taken. A
// visit that is not the client's says so, rather than offering to try again.

import { DisputeSheet } from "../booking/index.ts";
import { VisitCard } from "../home/index.ts";
import { LINKS_FRESH_MS, PhotoRow, type OpenPhoto, PhotoSheet, type Relink, useRelink } from "../photos/index.ts";
import { CLIENT_ICONS, ICONS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { textLinkLook } from "@maneman/ui/TextLink";
import { useLiveLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { dayMonth, fullDate, indiaClock, indiaDate, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useEffect, useState } from "react";
import { api, documentUrl, receiptUrl, type VisitDetail } from "../api.ts";
import { issues, messages, ONE_VISIT, payments, visitLength, visits, withGst } from "../content.ts";
import { AddToCalendar } from "./AddToCalendar.tsx";
import { RateVisit } from "./RateVisit.tsx";
import { OpenDocument } from "../payments/index.ts";
import { AppLink, Shell } from "../frame/Shell.tsx";
import { apiNow } from "@maneman/web-kit/clock";
import { invoiceState, oneVisitOf, visitName, visitTitle } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { firstNameOf } from "@rules/lib/names.ts";
import { Loading } from "@maneman/ui/States";
import { NotFound } from "../frame/NotFound.tsx";
import { go } from "../route.ts";
import { PageFailed } from "../frame/PageFailed.tsx";
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

/** A visit the client was not home for, in red: that we came and waited, and nothing was done. */
function MissedNotice({ note }: { note: NoShowNote }) {
  const copy = visits.detail.noShow;
  return (
    <div className={styles.missed} role="note">
      <Icon className={styles.missedIcon} d={CLIENT_ICONS.alert} size="md" />
      <p className={styles.missedWords}>
        <strong>{copy.label}</strong>
        {copy.line(note.waited_minutes)}
      </p>
    </div>
  );
}

/** What was ruled of a missed visit's charge, and where a dispute of it stands, among the visit's facts. */
function ChargeFacts({ note }: { note: NoShowNote }) {
  const copy = visits.detail.noShow;
  return (
    <>
      {/* A refund undoes the charge, so after one only its outcome is said. */}
      {note.dispute !== "refunded" && <Fact name={copy.charge} value={rulingOf(note)} />}
      {note.dispute !== null && <Fact name={copy.yourDispute} value={copy.disputed[note.dispute]} />}
    </>
  );
}

/** The way to dispute a missed visit's charge while it may be, or when the time to raise one ended. */
function Dispute({ visitId, note, onDisputed }: { visitId: string; note: NoShowNote; onDisputed: () => void }) {
  const [disputing, setDisputing] = useState(false);
  const copy = visits.detail.noShow;
  if (note.dispute_closed_at === null && !note.disputable) return null;
  return (
    <div className={styles.noShow}>
      {note.dispute_closed_at !== null && (
        <p className={styles.noShowLine}>{copy.disputeClosed(shortDate(indiaDate(note.dispute_closed_at)))}</p>
      )}
      {note.disputable && note.dispute_until !== null && (
        <p className={styles.noShowLine}>
          {copy.disputeUntil(`${dayMonth(indiaDate(note.dispute_until))}, ${indiaClock(note.dispute_until)}`)}
        </p>
      )}
      {note.disputable && (
        <Button
          variant="outline"
          size="action"
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
    </div>
  );
}

/** A fit the client signed off, and when; a first fit done, its guarantee, and the way to claim it while it runs. */
function FitFacts({ visit }: { visit: VisitDetail }) {
  const copy = visits.detail;
  const signedAt = visit.sign_off?.state === "signed" ? visit.sign_off.signed_at : null;
  const until = visit.guarantee_until;
  return (
    <>
      {signedAt !== null && (
        <Fact
          name={copy.signedOff}
          value={copy.signedBy(`${dayMonth(indiaDate(signedAt))}, ${indiaClock(signedAt)}`)}
        />
      )}
      {until !== null && (
        <div className={shared.fact}>
          <dt>{copy.guarantee}</dt>
          <dd>
            {copy.guaranteeUntil(dayMonth(until))}
            {todayInIndia(apiNow()) <= until && (
              <AppLink
                className={textLinkLook({ className: styles.claim })}
                to={`/visits/issues/new?about=fit_guarantee&visit=${visit.id}`}
              >
                {copy.notRight}
              </AppLink>
            )}
          </dd>
        </div>
      )}
    </>
  );
}

/** The visit's photographs, once there are any, each opened full size, and who sees them. */
function Photographs({ visit, relink }: { visit: VisitDetail; relink: Relink }) {
  const [open, setOpen] = useState<OpenPhoto | null>(null);
  if (visit.photos.before.length === 0 && visit.photos.after.length === 0) return null;
  return (
    <section aria-label={visits.detail.photographs}>
      <PhotoRow set={visit.photos} date={visit.date} onOpen={setOpen} relink={relink} />
      <p className={styles.private}>
        <Icon d={CLIENT_ICONS.lock} size="xs" />
        {visits.detail.private}
      </p>
      {open !== null && (
        <PhotoSheet
          photo={open}
          relink={relink}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </section>
  );
}

function PastVisit({ visit, onChanged, relink }: { visit: VisitDetail; onChanged: () => void; relink: Relink }) {
  const copy = visits.detail;
  return (
    <div className={shared.detail}>
      <p className={styles.kind}>{visitTitle(visit)}</p>
      {visit.status === "cancelled" && <p className={styles.cancelled}>{copy.cancelled}</p>}
      {visit.no_show !== null && <MissedNotice note={visit.no_show} />}
      <Photographs visit={visit} relink={relink} />
      <dl className={shared.facts}>
        <FitFacts visit={visit} />
        {visit.technician !== null && <Fact name={copy.technician} value={visit.technician.name} />}
        {visit.duration_minutes !== null && visit.duration_minutes > 0 && (
          <Fact name={copy.duration} value={visitLength(visit.duration_minutes)} numeric />
        )}
        {visit.paid !== null && <Paid paid={visit.paid} />}
        {visit.no_show !== null && <ChargeFacts note={visit.no_show} />}
      </dl>
      {visit.no_show !== null && <Dispute visitId={visit.id} note={visit.no_show} onDisputed={onChanged} />}
      {visit.what_was_done !== null && visit.what_was_done.length > 0 && (
        <section aria-labelledby="done">
          <h2 className={styles.section} id="done">
            {copy.done}
          </h2>
          <ul className={styles.doneList}>
            {visit.what_was_done.map((item) => (
              <li key={item}>
                <Icon className={styles.doneIcon} d={ICONS.tick} size="sm" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}
      {(visit.rateable || visit.rating !== null) && <RateVisit visit={visit} onRefused={onChanged} />}
      <div className={styles.documents}>
        <Receipt paid={visit.paid} />
        <Invoice visit={visit} />
      </div>
      {visit.status === "completed" && (
        <AppLink className={textLinkLook({ className: styles.report })} to={`/visits/issues/new?visit=${visit.id}`}>
          {issues.page.reportVisit}
        </AppLink>
      )}
    </div>
  );
}

/** What was paid, on a row as every other fact is. Its receipt is a document beside the invoice. */
function Paid({ paid }: { paid: NonNullable<VisitDetail["paid"]> }) {
  return (
    <div className={shared.fact}>
      <dt>{visits.detail.paid}</dt>
      <dd className={shared.numeric}>{withGst(rupees(paid.amount))}</dd>
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
      {visit.stage !== "booked" && <Photographs visit={visit} relink={relink} />}
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
    <Shell header={{ kind: "back", title, to: "/visits", label: visits.detail.back }} tab={null}>
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
