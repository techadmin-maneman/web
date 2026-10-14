// Partner commission, under Finance (docs/decisions/0124-partner-statements.md): for a month, what each partner's
// fitted friends earned it, less what refunds took back, what was paid and what is still owed. Each row downloads the
// statement sent to the partner, records the month's payment from the payout tool, or deletes one recorded by
// mistake; the month's file goes to the payout tool.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { fullMonth, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { api, type PartnerStatement, type PartnerStatements } from "../api.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { partnerCommission } from "../content/partner-commission.ts";
import { useAccess } from "../lib/access.ts";
import { saveFile } from "../lib/save-file.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { monthCsv, statementCsv } from "./partner-commission-csv.ts";
import { PayoutForm } from "./PayoutForm.tsx";
import styles from "../components/forms.module.css";
import own from "./partner-commission.module.css";
import { ActionRow } from "../components/ActionRow.tsx";

const copy = partnerCommission;
const columns = copy.columns;

/** An amount, or a dash for none; one below nothing with a minus before it. */
function amountOf(paise: number): string {
  if (paise === 0) return copy.empty;
  return paise < 0 ? `−${rupees(-paise)}` : rupees(paise);
}

/** The month before a month, "YYYY-MM". */
function monthBefore(month: string): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  return number === 1 ? `${String(year - 1)}-12` : `${String(year)}-${String(number - 1).padStart(2, "0")}`;
}

/** Every month from the first partner's to this one, newest first. */
function monthsOf(book: PartnerStatements): string[] {
  const months: string[] = [];
  for (let month = book.this_month; month >= book.first_month; month = monthBefore(month)) months.push(month);
  return months;
}

/** What is open beneath a partner's row. */
type Acting = { readonly id: string; readonly kind: "pay" | "delete" } | null;

interface RowProps {
  readonly book: PartnerStatements;
  readonly mayPay: boolean;
  readonly acting: Acting;
  readonly onAct: (acting: Acting) => void;
  readonly onDone: (book: PartnerStatements, said: string) => void;
}

function RowActions({ statement, book, mayPay, acting, onAct }: { statement: PartnerStatement } & RowProps) {
  const act = (kind: NonNullable<Acting>["kind"]) => {
    onAct({ id: statement.channel_id, kind });
  };
  const offer = (kind: NonNullable<Acting>["kind"], words: string, label: string) => (
    <RowButton
      className={styles.inline}
      aria-label={label}
      disabled={acting !== null}
      onClick={() => {
        act(kind);
      }}
    >
      {words}
    </RowButton>
  );
  return (
    <td className={own.actions}>
      <RowButton
        className={styles.inline}
        aria-label={copy.statementLabel(statement.name)}
        onClick={() => {
          saveFile(
            copy.statementName(statement.code, book.month),
            statementCsv(statement, fullMonth(book.month)),
            "text/csv",
          );
        }}
      >
        {copy.statement}
      </RowButton>
      {mayPay &&
        book.month < book.this_month &&
        statement.payout === null &&
        offer("pay", copy.record, copy.recordLabel(statement.name))}
      {mayPay &&
        statement.payout !== null &&
        offer("delete", copy.deletePayment, copy.deletePaymentLabel(statement.name))}
    </td>
  );
}

/** Beneath a partner's row, what its action opened. */
function ActingRow({ statement, book, acting, onAct, onDone }: { statement: PartnerStatement } & RowProps) {
  if (acting?.id !== statement.channel_id) return null;
  const cancel = () => {
    onAct(null);
  };
  return (
    <ActionRow className={own.acting}>
      {acting.kind === "pay" ? (
        <PayoutForm
          statement={statement}
          month={book.month}
          monthName={fullMonth(book.month)}
          today={book.today}
          maxAmount={book.max_amount}
          onDone={(next) => {
            onDone(next, copy.done.recorded);
          }}
          onCancel={cancel}
        />
      ) : (
        <div className={own.ask}>
          <DeleteAction
            name={copy.paymentTo(statement.name, fullMonth(book.month))}
            send={() => api.deletePartnerPayout(statement.channel_id, book.month)}
            refusal={(refused) => errorText(copy.errors, { code: refused, fields: [] })}
            onDeleted={(next) => {
              onDone(next, copy.done.deleted);
            }}
            onCancel={cancel}
          />
        </div>
      )}
    </ActionRow>
  );
}

function StatementRows({ statement, ...row }: { statement: PartnerStatement } & RowProps) {
  const { payout } = statement;
  return (
    <>
      <tr>
        <th scope="row" className={own.name}>
          {statement.name}
        </th>
        <td className={own.figure}>{statement.fitted}</td>
        <td className={own.figure}>{amountOf(statement.earned)}</td>
        <td className={own.figure}>{amountOf(statement.taken_back_amount)}</td>
        <td className={own.figure}>{amountOf(statement.due)}</td>
        <td className={own.figure}>
          {payout === null ? copy.empty : copy.paid(rupees(payout.amount), shortDate(payout.paid_on))}
          {payout !== null && <span className={own.reference}>{payout.reference}</span>}
        </td>
        <td className={own.figure}>{amountOf(statement.owed)}</td>
        <RowActions statement={statement} {...row} />
      </tr>
      <ActingRow statement={statement} {...row} />
    </>
  );
}

function StatementsTable(row: RowProps) {
  const figures = [columns.fitted, columns.earned, columns.takenBack, columns.due, columns.paid, columns.owed];
  return (
    <div className={own.scroll}>
      <Table className={classes(styles.table, own.table)}>
        <thead>
          <tr>
            <th scope="col">{columns.partner}</th>
            {figures.map((label) => (
              <th key={label} scope="col" className={own.figure}>
                {label}
              </th>
            ))}
            <th scope="col">
              <VisuallyHidden>{columns.actions}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {row.book.statements.map((statement) => (
            <StatementRows key={statement.channel_id} statement={statement} {...row} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function MonthChoice({ book, onMonth }: { book: PartnerStatements; onMonth: (month: string) => void }) {
  return (
    <div className={own.tools}>
      <Field label={copy.month}>
        {(control) => (
          <Select
            {...control}
            className={styles.choiceBox}
            value={book.month}
            onChange={(event) => {
              onMonth(event.target.value);
            }}
          >
            {monthsOf(book).map((month) => (
              <option key={month} value={month}>
                {month === book.this_month ? copy.soFar(fullMonth(month)) : fullMonth(month)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

export function PartnerCommission() {
  const [month, setMonth] = useState<string | null>(null);
  const load = useCallback(() => api.partnerStatements(month), [month]);
  const [loaded, retry] = useLoad(load);
  /** The month as the last change left it, so the page follows a change without reading it again. */
  const [changed, setChanged] = useState<PartnerStatements | null>(null);
  const [acting, setActing] = useState<Acting>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayPay = useAccess().mayCall("POST /api/partner-statements/{id}/payouts");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const book = changed ?? loaded.value;
  const row: RowProps = {
    book,
    mayPay,
    acting,
    onAct: (next) => {
      setSaid(null);
      setActing(next);
    },
    onDone: (next, words) => {
      setActing(null);
      setSaid(words);
      setChanged(next);
    },
  };
  const choose = (next: string) => {
    setChanged(null);
    setActing(null);
    setSaid(null);
    setMonth(next);
  };
  return (
    <Panel
      titleId="partner-commission"
      title={copy.title}
      className={styles.panel}
      actions={
        book.statements.length > 0 && (
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            onClick={() => {
              saveFile(copy.downloadName(book.month), monthCsv(book.statements), "text/csv");
            }}
          >
            {copy.download}
          </Button>
        )
      }
    >
      <MonthChoice book={book} onMonth={choose} />
      {said !== null && (
        <InlineMessage tone="saved" className={styles.saved}>
          {said}
        </InlineMessage>
      )}
      {book.statements.length === 0 ? <p className={styles.note}>{copy.none}</p> : <StatementsTable {...row} />}
    </Panel>
  );
}
