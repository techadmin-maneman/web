// The client's Payments tab: what they have paid and had back, from the record
// the page already holds, their service-visit credits, which ops can put right
// by hand (docs/decisions/0068-a-paid-hold-is-kept.md), and the invite they came
// with, whose grant is credits (Invite.tsx). The board draws the tab and nothing
// in it (docs/fidelity-method.md).
//
// A credit given or taken in error once needed SQL to correct. The form sends
// the visits and the reason, and the server writes the ledger's entry and its
// audit entry together; the balance it answers is shown, and heads the page.

import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { fullDate, longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type ClientInvite, type ClientPayment, type ClientRecord, type CreditAdjustment } from "../api.ts";
import { clients } from "../content.ts";
import styles from "./clients.module.css";
import { Invite, type InviteNews } from "./Invite.tsx";

type Credits = ClientRecord["credits"];
type Reason = CreditAdjustment["reason"];

const copy = clients.payments;
const creditCopy = clients.credits;

/** The most visits one adjustment may add or take away, as the route allows. */
const MOST_VISITS = 12;

/** What a row was for: the visit it paid for, a late fee, or a refund. */
function whatOf(entry: ClientPayment): string {
  if (entry.kind === "refund") return copy.refund;
  if (entry.purpose === "late_fee") return copy.lateFee;
  if (entry.visit === null) return copy.unlinked;
  const type = entry.visit.type === null ? copy.unlinked : clients.visits.types[entry.visit.type];
  return copy.visit(type, fullDate(entry.visit.date));
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
          {copy.columns.map((column, index) => (
            <th key={column} scope="col" className={index === 2 ? styles.figureCell : styles.cell}>
              {column}
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
      <h3 className={styles.sectionTitle} id="credits">
        {creditCopy.title}
      </h3>
      <dl className={styles.address}>
        <div className={styles.addressRow}>
          <dt className={styles.metaKey}>{creditCopy.balance}</dt>
          <dd className={styles.addressValue}>
            {credits === null ? creditCopy.none : creditCopy.visits(credits.visits)}
            {expiry !== null && ` ${creditCopy.expiry(longDate(expiry))}`}
          </dd>
        </div>
      </dl>
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
            {creditCopy.errors[adjusting.code] ?? creditCopy.errors.unknown}
          </p>
        )}
      </form>
    </section>
  );
}

export function Payments({
  clientId,
  payments,
  credits,
  onCredits,
  invite,
  inviteNews,
  onInvite,
}: {
  clientId: string;
  payments: readonly ClientPayment[];
  credits: Credits;
  onCredits: (credits: Credits) => void;
  invite: ClientInvite | null;
  inviteNews: InviteNews | null;
  onInvite: (invite: ClientInvite, news: InviteNews) => void;
}) {
  return (
    <div className={styles.visits}>
      <section className={styles.visitList} aria-label={copy.title}>
        <h3 className={styles.sectionTitle}>{copy.title}</h3>
        <PaymentTable payments={payments} />
      </section>
      <CreditForm clientId={clientId} credits={credits} onCredits={onCredits} />
      <Invite clientId={clientId} invite={invite} news={inviteNews} onInvite={onInvite} />
    </div>
  );
}
