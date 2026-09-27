// One payment or refund (board E2): the ex-GST amount, then the inclusive one
// with its GST rate, the facts, and its tax documents. A payment's are the
// visit's tax invoice, from Books, and the receipt; a charge's and a late
// fee's, the receipt alone. A refund's is its voucher and its destination. A
// document not yet raised says so (board E3), in words that fit how long it
// has been, with Notify me, which asks ops on WhatsApp until the app can tell
// the client itself. A refund past its working days says it is late.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { useLoad } from "@maneman/ui/useLoad";
import { fullDate, indiaDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import { api, documentUrl, receiptUrl, type EntryDetail } from "../api.ts";
import { messages, payments } from "../content.ts";
import { Shell } from "../home/Shell.tsx";
import { apiNow } from "../lib/clock.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { Loading } from "../states/Loading.tsx";
import { NotFound } from "../states/NotFound.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import {
  chargeEvidence,
  documentsOf,
  entryNamed,
  entryStatus,
  entryTitle,
  entryWhat,
  methodName,
  missingInvoice,
  refundIsLate,
} from "./entry.ts";
import styles from "./payments.module.css";

type Missing = "invoice" | "invoiceAfterVisit" | "invoiceLate" | "receipt" | "voucher";

function Document(props: { name: string; href: string | null; missing: Missing; entry: string }) {
  const [asked, setAsked] = useState(false);
  const icon = <Icon className={styles.documentIcon} d={ICONS.download} size={18} />;
  if (props.href !== null) {
    return (
      <a className={styles.document} href={props.href} target="_blank" rel="noopener">
        <span>{props.name}</span>
        <span className={styles.away}>{payments.newTab}</span>
        {icon}
      </a>
    );
  }
  return (
    <>
      <button
        className={styles.document}
        type="button"
        aria-expanded={asked}
        onClick={() => {
          setAsked(true);
        }}
      >
        <span>{props.name}</span>
        {icon}
      </button>
      {asked && (
        <div className={styles.unavailable} role="status">
          <p>{payments.unavailable[props.missing]}</p>
          <a className={styles.notify} href={whatsappWith(messages.document(props.name, props.entry))} rel="noopener">
            {payments.unavailable.notify}
          </a>
        </div>
      )}
    </>
  );
}

function Fact({ name, value, numeric = false }: { name: string; value: string; numeric?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt>{name}</dt>
      <dd className={numeric ? styles.numeric : undefined}>{value}</dd>
    </div>
  );
}

/** A payment's documents: its visit's invoice and its receipt, or the receipt alone for a charge or a late fee. */
function PaymentDocuments({ entry, today }: { entry: Extract<EntryDetail, { kind: "payment" }>; today: string }) {
  const named = entryNamed(entry);
  return documentsOf(entry).map((document) =>
    document === "invoice" ? (
      <Document
        key={document}
        name={payments.invoice}
        href={entry.documents.invoice === null ? null : documentUrl(entry.documents.invoice)}
        missing={missingInvoice(entry, today)}
        entry={named}
      />
    ) : (
      <Document
        key={document}
        name={payments.receipt}
        href={entry.documents.receipt === null ? null : receiptUrl(entry.documents.receipt)}
        missing="receipt"
        entry={named}
      />
    ),
  );
}

function Detail({ entry }: { entry: EntryDetail }) {
  const rows = payments.rows;
  const method = methodName(entry.kind === "refund" ? entry.destination : entry.method, "long");
  const today = indiaDate(new Date(apiNow()).toISOString());
  const late = refundIsLate(entry, today);
  return (
    <div className={styles.detail}>
      <p className={styles.bigAmount}>{rupees(entry.amount_ex_gst)}</p>
      <p className={styles.including}>{payments.including(rupees(entry.amount), entry.gst_percent)}</p>
      <dl className={styles.facts}>
        <Fact name={rows.date} value={fullDate(entry.date)} />
        {method !== null && <Fact name={entry.kind === "refund" ? rows.destination : rows.method} value={method} />}
        <Fact name={rows.status} value={late ? payments.lateRefund : entryStatus(entry, true)} />
        {entry.kind === "payment" && entry.charge !== null && (
          <Fact name={payments.charge} value={chargeEvidence(entry.charge)} />
        )}
        {entry.kind === "payment" && entry.no_show !== null && (
          <Fact
            name={payments.noShow.label}
            value={payments.noShow.fact(entry.no_show.waited_minutes, payments.noShow.decision[entry.no_show.decision])}
          />
        )}
        {entry.kind === "payment" && entry.reference !== null && (
          <Fact name={rows.reference} value={entry.reference} numeric />
        )}
      </dl>
      {late && (
        <a
          className={styles.notify}
          href={whatsappWith(messages.lateRefund(entryWhat(entry), fullDate(entry.date)))}
          rel="noopener"
        >
          {payments.message}
        </a>
      )}
      <h2 className={styles.label}>{payments.documents}</h2>
      <div className={styles.documents}>
        {entry.kind === "payment" ? (
          <PaymentDocuments entry={entry} today={today} />
        ) : (
          <Document name={payments.voucher} href={entry.voucher} missing="voucher" entry={entryNamed(entry)} />
        )}
      </div>
    </div>
  );
}

export function EntryScreen({ id }: { id: string }) {
  const [loaded, retry] = useLoad(useCallback(() => api.entry(id), [id]));
  const title = loaded.state === "loaded" ? entryTitle(loaded.value) : payments.title;
  return (
    <Shell header={{ kind: "back", title, to: "/payments", label: payments.back }} tab="/payments">
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && loaded.notFound && (
        <NotFound message={payments.notFound} back={payments.back} to="/payments" />
      )}
      {loaded.state === "failed" && !loaded.notFound && <PageFailed onRetry={retry} />}
      {loaded.state === "loaded" && <Detail entry={loaded.value} />}
    </Shell>
  );
}
