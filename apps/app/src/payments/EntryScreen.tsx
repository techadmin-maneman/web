// One payment or refund (board E2): the ex-GST amount, then the inclusive one
// with its GST rate, the facts, and its tax documents. A payment's are the
// tax invoice, from Books, and the receipt; a refund's is its voucher and its
// destination. A document not yet raised says so (board E3), with Notify me,
// which asks ops on WhatsApp until the app can tell the client itself.

import { ICONS } from "@maneman/brand/icons";
import { fullDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import { api, documentUrl, receiptUrl, type EntryDetail } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { messages, payments } from "../content.ts";
import { Shell } from "../home/Shell.tsx";
import { useLoad } from "../lib/useLoad.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { chargeEvidence, entryNamed, entryStatus, entryTitle, methodName } from "./entry.ts";
import styles from "./payments.module.css";

type Missing = "invoice" | "receipt" | "voucher";

function Document(props: { name: string; href: string | null; missing: Missing; entry: string }) {
  const [asked, setAsked] = useState(false);
  const inside = (
    <>
      <span>{props.name}</span>
      <Icon className={styles.documentIcon} d={ICONS.download} size={18} />
    </>
  );
  if (props.href !== null) {
    return (
      <a className={styles.document} href={props.href} target="_blank" rel="noopener">
        {inside}
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
        {inside}
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

function Detail({ entry }: { entry: EntryDetail }) {
  const rows = payments.rows;
  const named = entryNamed(entry);
  const method = methodName(entry.kind === "refund" ? entry.destination : entry.method, "long");
  return (
    <div className={styles.detail}>
      <p className={styles.bigAmount}>{rupees(entry.amount_ex_gst)}</p>
      <p className={styles.including}>{payments.including(rupees(entry.amount), entry.gst_percent)}</p>
      <dl className={styles.facts}>
        <Fact name={rows.date} value={fullDate(entry.date)} />
        {method !== null && <Fact name={entry.kind === "refund" ? rows.destination : rows.method} value={method} />}
        <Fact name={rows.status} value={entryStatus(entry, true)} />
        {entry.kind === "payment" && entry.charge !== null && (
          <Fact name={payments.charge} value={chargeEvidence(entry.charge)} />
        )}
        {entry.kind === "payment" && entry.reference !== null && (
          <Fact name={rows.reference} value={entry.reference} numeric />
        )}
      </dl>
      <h2 className={styles.label}>{payments.documents}</h2>
      <div className={styles.documents}>
        {entry.kind === "payment" ? (
          <>
            <Document
              name={payments.invoice}
              href={entry.documents.invoice === null ? null : documentUrl(entry.documents.invoice)}
              missing="invoice"
              entry={named}
            />
            <Document
              name={payments.receipt}
              href={entry.documents.receipt === null ? null : receiptUrl(entry.documents.receipt)}
              missing="receipt"
              entry={named}
            />
          </>
        ) : (
          <Document name={payments.voucher} href={entry.voucher} missing="voucher" entry={named} />
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
      {loaded.state === "loading" ? (
        <Loading />
      ) : loaded.state === "failed" ? (
        <PageFailed onRetry={retry} />
      ) : (
        <Detail entry={loaded.value} />
      )}
    </Shell>
  );
}
