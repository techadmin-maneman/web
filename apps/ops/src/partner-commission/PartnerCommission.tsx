// Partner commission, under Finance (docs/decisions/0124-partner-statements.md): for a month, what each partner's
// fitted friends earned it, less what refunds took back, what was paid and what is still owed. Each row downloads the
// statement sent to the partner, records the month's payment from the payout tool, or deletes one recorded by
// mistake; the month's file goes to the payout tool.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useLoad } from "@maneman/ui/useLoad";
import { fullMonth, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { type PartnerStatement, type PartnerStatements } from "../api.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { partnerCommission } from "../content/partner-commission.ts";
import { useAccess } from "../lib/access.ts";
import { saveFile } from "../lib/save-file.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { monthCsv, statementCsv } from "./partner-commission-csv.ts";
import { PayoutForm } from "./PayoutForm.tsx";
import form from "../components/forms.module.css";
import styles from "./partner-commission.module.css";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { partnerCommissionApi } from "./partner-commission-api.ts";

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
function monthsOf(statements: PartnerStatements): string[] {
  const months: string[] = [];
  for (let month = statements.this_month; month >= statements.first_month; month = monthBefore(month))
    months.push(month);
  return months;
}

/** What is open beneath a partner's row. */
type Acting = { readonly id: string; readonly kind: "pay" | "delete" } | null;

interface RowProps {
  readonly statements: PartnerStatements;
  readonly mayPay: boolean;
  readonly acting: Acting;
  readonly onAct: (acting: Acting) => void;
  readonly onDone: (statements: PartnerStatements, said: string) => void;
}

function StatementActions({
  statement,
  statements,
  mayPay,
  acting,
  onAct,
}: { statement: PartnerStatement } & RowProps) {
  const act = (kind: NonNullable<Acting>["kind"]) => {
    onAct({ id: statement.channel_id, kind });
  };
  const offer = (kind: NonNullable<Acting>["kind"], words: string, label: string) => (
    <RowButton
      beside
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
    <td className={styles.actions}>
      <RowButton
        beside
        aria-label={copy.statementLabel(statement.name)}
        onClick={() => {
          saveFile(
            copy.statementName(statement.code, statements.month),
            statementCsv(statement, fullMonth(statements.month)),
            "text/csv",
          );
        }}
      >
        {copy.statement}
      </RowButton>
      {mayPay &&
        statements.month < statements.this_month &&
        statement.payout === null &&
        offer("pay", copy.record, copy.recordLabel(statement.name))}
      {mayPay &&
        statement.payout !== null &&
        offer("delete", copy.deletePayment, copy.deletePaymentLabel(statement.name))}
    </td>
  );
}

/** Beneath a partner's row, what its action opened. */
function StatementActingRow({
  statement,
  statements,
  acting,
  onAct,
  onDone,
}: { statement: PartnerStatement } & RowProps) {
  if (acting?.id !== statement.channel_id) return null;
  const cancel = () => {
    onAct(null);
  };
  return (
    <FormDrawer title={statement.name} onClose={cancel}>
      {acting.kind === "pay" ? (
        <PayoutForm
          statement={statement}
          month={statements.month}
          monthName={fullMonth(statements.month)}
          today={statements.today}
          maxAmount={statements.max_amount}
          onDone={(next) => {
            onDone(next, copy.done.recorded);
          }}
          onCancel={cancel}
        />
      ) : (
        <div className={styles.ask}>
          <DeleteAction
            name={copy.paymentTo(statement.name, fullMonth(statements.month))}
            send={() => partnerCommissionApi.deletePartnerPayout(statement.channel_id, statements.month)}
            refusal={(refused) => errorText(copy.errors, { code: refused, fields: [] })}
            onDeleted={(next) => {
              onDone(next, copy.done.deleted);
            }}
            onCancel={cancel}
          />
        </div>
      )}
    </FormDrawer>
  );
}

function StatementRows({ statement, ...row }: { statement: PartnerStatement } & RowProps) {
  const { payout } = statement;
  return (
    <>
      <tr>
        <th scope="row" className={styles.name}>
          {statement.name}
        </th>
        <td className={styles.figure}>{statement.fitted}</td>
        <td className={styles.figure}>{amountOf(statement.earned)}</td>
        <td className={styles.figure}>{amountOf(statement.taken_back_amount)}</td>
        <td className={styles.figure}>{amountOf(statement.due)}</td>
        <td className={styles.figure}>
          {payout === null ? copy.empty : copy.paid(rupees(payout.amount), shortDate(payout.paid_on))}
          {payout !== null && <span className={styles.reference}>{payout.reference}</span>}
        </td>
        <td className={styles.figure}>{amountOf(statement.owed)}</td>
        <StatementActions statement={statement} {...row} />
      </tr>
      <StatementActingRow statement={statement} {...row} />
    </>
  );
}

function StatementsTable(row: RowProps) {
  const figures = [columns.fitted, columns.earned, columns.takenBack, columns.due, columns.paid, columns.owed];
  return (
    <div className={styles.scroll}>
      <Table controls className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{columns.partner}</th>
            {figures.map((label) => (
              <th key={label} scope="col" className={styles.figure}>
                {label}
              </th>
            ))}
            <th scope="col">
              <VisuallyHidden>{columns.actions}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {row.statements.statements.map((statement) => (
            <StatementRows key={statement.channel_id} statement={statement} {...row} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function MonthChoice({ statements, onMonth }: { statements: PartnerStatements; onMonth: (month: string) => void }) {
  return (
    <div className={styles.tools}>
      <Field label={copy.month}>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={statements.month}
            onChange={(event) => {
              onMonth(event.target.value);
            }}
          >
            {monthsOf(statements).map((month) => (
              <option key={month} value={month}>
                {month === statements.this_month ? copy.soFar(fullMonth(month)) : fullMonth(month)}
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
  const load = useCallback(() => partnerCommissionApi.partnerStatements(month), [month]);
  const [loaded, retry] = useLoad(load);
  /** The month as the last change left it, so the page follows a change without reading it again. */
  const [changed, setChanged] = useState<PartnerStatements | null>(null);
  const [acting, setActing] = useState<Acting>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayPay = useAccess().mayCall("POST /api/partner-statements/{id}/payouts");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const statements = changed ?? loaded.value;
  const row: RowProps = {
    statements,
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
      padded
      actions={
        statements.statements.length > 0 && (
          <Button
            variant="outline"
            size="small"
            narrow
            onClick={() => {
              saveFile(copy.downloadName(statements.month), monthCsv(statements.statements), "text/csv");
            }}
          >
            {copy.download}
          </Button>
        )
      }
    >
      <MonthChoice statements={statements} onMonth={choose} />
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {statements.statements.length === 0 ? <Note>{copy.none}</Note> : <StatementsTable {...row} />}
    </Panel>
  );
}
