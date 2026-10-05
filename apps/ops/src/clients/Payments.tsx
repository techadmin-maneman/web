// The client's Payments tab: what they have paid and had back, the payment
// links they were sent and the invoice of each finished visit, all from the
// record the page already holds; and their service-visit credits, which ops can
// put right by hand (docs/decisions/0068-a-paid-hold-is-kept.md). The board
// draws the tab and nothing in it (docs/fidelity-method.md).
//
// A credit given or taken in error once needed SQL to correct. The form sends
// the visits and the reason, and the server writes the ledger's entry and its
// audit entry together; the balance it answers is shown, and heads the page.

import { errorText } from "@maneman/web-kit/refusal";
import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate, longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import {
  api,
  type ClientInvoice,
  type ClientPayment,
  type ClientPaymentLink,
  type ClientRecord,
  type CreditAdjustment,
} from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./clients.module.css";

type Credits = ClientRecord["credits"];
type Reason = CreditAdjustment["reason"];

const copy = clients.payments;
const linkCopy = clients.links;
const invoiceCopy = clients.invoices;
const creditCopy = clients.credits;

/** The most visits one adjustment may add or take away, as the route allows. */
const MOST_VISITS = 12;

/** What a row was for: the visit it paid for, or the booking that is to be one, a late fee, or a refund. */
function whatOf(entry: ClientPayment): string {
  if (entry.kind === "refund") return copy.refund;
  if (entry.purpose === "late_fee") return copy.lateFee;
  const paidFor = entry.visit ?? entry.booking;
  const type = paidFor?.type ?? null;
  if (paidFor === null || type === null) return copy.unlinked;
  return copy.visit(clients.visits.types[type], fullDate(paidFor.date));
}

/** The discount code a visit's payment was made with, and what it took off before GST; null for none. */
function codeOf(entry: ClientPayment): string | null {
  if (entry.kind === "refund" || entry.discount_code === null) return null;
  const { code, amount_off: off } = entry.discount_code;
  return copy.code(clients.visits.code.applied(code, off === null ? null : rupees(off)));
}

function stateOf(entry: ClientPayment): string {
  const state = entry.kind === "refund" ? copy.refundStates[entry.status] : copy.paymentStates[entry.status];
  const reference = entry.kind === "payment" && entry.reference !== null ? ` · ${copy.reference(entry.reference)}` : "";
  return `${state ?? clients.unknown}${reference}`;
}

function CodeLine({ entry }: { entry: ClientPayment }) {
  const code = codeOf(entry);
  return code === null ? null : <span className={styles.closedLine}>{code}</span>;
}

function PaymentTable({ payments }: { payments: readonly ClientPayment[] }) {
  if (payments.length === 0) return <p className={styles.empty}>{copy.none}</p>;
  return (
    <Table className={styles.table}>
      <thead>
        <tr>
          {(["date", "what", "amount", "state"] as const).map((column) => (
            <th key={column} scope="col" className={column === "amount" ? styles.figureCell : styles.cell}>
              {copy.columns[column]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {payments.map((entry) => (
          <tr key={entry.id}>
            <td className={styles.cell}>{fullDate(entry.date)}</td>
            <td className={styles.cell}>
              {whatOf(entry)}
              <CodeLine entry={entry} />
            </td>
            <td className={styles.figureCell}>{rupees(entry.amount)}</td>
            <td className={styles.quietCell}>{stateOf(entry)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** "Natural hair system, visit of 25 Sep 2027". */
const linkWhatOf = (link: ClientPaymentLink): string =>
  linkCopy.what(link.product, link.visit_date === null ? null : fullDate(link.visit_date));

function linkStateOf(link: ClientPaymentLink): string {
  const state = link.paid_at === null ? linkCopy.states[link.state] : linkCopy.paidOn(longDate(link.paid_at));
  return link.reference === null ? state : `${state} · ${linkCopy.reference(link.reference)}`;
}

/** An open link's address, to read out to the client or send them again. */
function CopyLink({ url, what }: { url: string; what: string }) {
  const [copied, setCopied] = useState(false);
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // The address stays on the row to be selected by hand.
      setCopied(false);
    }
  };
  return (
    <span className={styles.linkLine}>
      <span className={styles.linkUrl}>{url}</span>
      <Button variant="outline" size="small" className={styles.copyLink} onClick={() => void copyUrl()}>
        {copied ? linkCopy.copied : linkCopy.copy}
        <VisuallyHidden>{` · ${what}`}</VisuallyHidden>
      </Button>
    </span>
  );
}

function LinkTable({ links }: { links: readonly ClientPaymentLink[] }) {
  if (links.length === 0) return <p className={styles.empty}>{linkCopy.none}</p>;
  return (
    <Table className={styles.table}>
      <thead>
        <tr>
          {(["sent", "for", "amount", "state"] as const).map((column) => (
            <th key={column} scope="col" className={column === "amount" ? styles.figureCell : styles.cell}>
              {linkCopy.columns[column]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr key={link.id}>
            <td className={styles.cell}>{link.sent_at === null ? linkCopy.unsent : longDate(link.sent_at)}</td>
            <td className={styles.cell}>{linkWhatOf(link)}</td>
            <td className={styles.figureCell}>{rupees(link.amount)}</td>
            <td className={styles.quietCell}>
              {linkStateOf(link)}
              {link.state === "open" && link.short_url !== null && (
                <CopyLink url={link.short_url} what={linkWhatOf(link)} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function invoiceStateOf(invoice: ClientInvoice): string {
  if (invoice.issued_at !== null) return invoiceCopy.sentOn(longDate(invoice.issued_at));
  return invoiceCopy.states[invoice.state];
}

function InvoiceTable({ invoices }: { invoices: readonly ClientInvoice[] }) {
  if (invoices.length === 0) return <p className={styles.empty}>{invoiceCopy.none}</p>;
  return (
    <Table className={styles.table}>
      <thead>
        <tr>
          {invoiceCopy.columns.map((column) => (
            <th key={column} scope="col" className={styles.cell}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {invoices.map((invoice) => (
          <tr key={invoice.visit_id}>
            <td className={styles.cell}>{copy.visit(clients.visits.types[invoice.type], fullDate(invoice.date))}</td>
            <td className={styles.quietCell}>{invoiceStateOf(invoice)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Where the form is: being filled, sending, done with the balance it answered, or refused. */
type Adjusting =
  | { readonly step: "open" }
  | { readonly step: "sending" }
  | { readonly step: "done"; readonly visits: number }
  | { readonly step: "failed"; readonly code: string };

/** A whole number from -12 to 12 that is not nought, or null. */
function visitsOf(typed: string): number | null {
  if (!/^-?\d{1,2}$/.test(typed.trim())) return null;
  const visits = Number(typed.trim());
  return visits === 0 || Math.abs(visits) > MOST_VISITS ? null : visits;
}

function CreditForm({
  clientId,
  credits,
  onCredits,
}: {
  clientId: string;
  credits: Credits;
  onCredits: (credits: Credits) => void;
}) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState<Reason | "">("");
  const [adjusting, setAdjusting] = useState<Adjusting>({ step: "open" });
  const mayAdjust = useAccess().mayCall("POST /api/clients/{id}/credits");
  const visits = visitsOf(typed);
  const sending = adjusting.step === "sending";
  const expiry = credits?.earliest_expiry ?? null;

  const send = async (change: { visits: number; reason: Reason }) => {
    setAdjusting({ step: "sending" });
    const answer = await api.adjustCredits(clientId, change);
    if (!answer.ok) {
      setAdjusting({ step: "failed", code: answer.code });
      return;
    }
    setAdjusting({ step: "done", visits: answer.body.visits });
    setTyped("");
    setReason("");
    onCredits(answer.body.visits > 0 ? answer.body : null);
  };

  return (
    <section className={styles.credits} aria-labelledby="credits">
      <h3 className={capsLook(styles.sectionTitle)} id="credits">
        {creditCopy.title}
      </h3>
      <dl className={styles.address}>
        <div className={styles.addressRow}>
          <dt className={styles.metaKey}>{creditCopy.balance}</dt>
          <dd className={styles.addressValue}>
            {credits === null ? creditCopy.none : creditCopy.visits(credits.visits)}
            {expiry !== null && ` · ${creditCopy.useBy(longDate(expiry))}`}
          </dd>
        </div>
      </dl>
      {mayAdjust && (
        <form
          className={styles.creditForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (visits !== null && reason !== "") void send({ visits, reason });
          }}
        >
          <label className={styles.fieldLabel} htmlFor="credit-visits">
            {creditCopy.change}
          </label>
          <input
            id="credit-visits"
            className={styles.numberField}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-describedby="credit-visits-hint"
            value={typed}
            disabled={sending}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
          <p className={styles.findHint} id="credit-visits-hint">
            {creditCopy.changeHint}
          </p>
          <fieldset className={styles.reasons} disabled={sending}>
            <legend className={styles.fieldLabel}>{creditCopy.reason}</legend>
            {creditCopy.reasons.map((each) => (
              <label className={styles.reasonOption} key={each.reason}>
                <input
                  className={styles.radio}
                  type="radio"
                  name="credit-reason"
                  value={each.reason}
                  checked={reason === each.reason}
                  onChange={() => {
                    setReason(each.reason);
                  }}
                />
                <span>{each.label}</span>
              </label>
            ))}
          </fieldset>
          <p className={styles.note}>{creditCopy.note}</p>
          <Button
            variant="primary"
            size="small"
            className={styles.primary}
            type="submit"
            disabled={sending || visits === null || reason === ""}
          >
            {sending ? creditCopy.saving : creditCopy.save}
          </Button>
          {adjusting.step === "done" && (
            <p className={styles.done} role="status">
              {creditCopy.saved(adjusting.visits)}
            </p>
          )}
          {adjusting.step === "failed" && (
            <p className={styles.error} role="alert">
              {errorText(creditCopy.errors, { code: adjusting.code })}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

export function Payments({
  clientId,
  payments,
  links,
  invoices,
  credits,
  onCredits,
}: {
  clientId: string;
  payments: readonly ClientPayment[];
  links: readonly ClientPaymentLink[];
  invoices: readonly ClientInvoice[];
  credits: Credits;
  onCredits: (credits: Credits) => void;
}) {
  return (
    <div className={styles.visits}>
      <MoneyRecords payments={payments} links={links} invoices={invoices} />
      <CreditForm clientId={clientId} credits={credits} onCredits={onCredits} />
    </div>
  );
}

/** What the client paid and had back, the payment links they were sent, and each finished visit's invoice. */
export function MoneyRecords({
  payments,
  links,
  invoices,
}: {
  payments: readonly ClientPayment[];
  links: readonly ClientPaymentLink[];
  invoices: readonly ClientInvoice[];
}) {
  return (
    <>
      <section className={styles.visitList} aria-label={copy.title}>
        <h3 className={capsLook(styles.sectionTitle)}>{copy.title}</h3>
        <PaymentTable payments={payments} />
      </section>
      <section className={styles.visitList} aria-label={linkCopy.title}>
        <h3 className={capsLook(styles.sectionTitle)}>{linkCopy.title}</h3>
        <LinkTable links={links} />
      </section>
      <section className={styles.visitList} aria-label={invoiceCopy.title}>
        <h3 className={capsLook(styles.sectionTitle)}>{invoiceCopy.title}</h3>
        <InvoiceTable invoices={invoices} />
      </section>
    </>
  );
}
