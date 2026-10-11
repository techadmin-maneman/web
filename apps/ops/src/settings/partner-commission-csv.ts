// The Partner commission page's files (docs/decisions/0124-partner-statements.md): a partner's statement for a month,
// sent to them, and the month for every partner, for the payout tool. Amounts are rupees to the paisa, as a
// spreadsheet adds them; a statement holds days and amounts, never a client.

import type { components } from "../api-schema.ts";
import { partnerCommission } from "../content/partner-commission.ts";
import { csvText } from "../lib/csv.ts";

/** A partner's month, as GET /api/partner-statements gives it; from the schema, so the node tests read it too. */
type PartnerStatement = components["schemas"]["PartnerStatements"]["statements"][number];

const copy = partnerCommission;

const rupeesOf = (paise: number): string => (paise / 100).toFixed(2);

/** One partner's month: each fit and each taking back, by day, then what the month came to and what was paid. */
export function statementCsv(statement: PartnerStatement, monthName: string): string {
  const file = copy.statementFile;
  const lines = statement.lines.map((line) =>
    line.kind === "fitted"
      ? [line.day, file.fitted, rupeesOf(line.commission)]
      : [line.day, file.takenBack, rupeesOf(-line.commission)],
  );
  const paid =
    statement.payout === null
      ? []
      : [["", file.paid(statement.payout.paid_on, statement.payout.reference), rupeesOf(statement.payout.amount)]];
  return csvText([
    [file.partner, statement.name],
    [file.month, monthName],
    [],
    file.head,
    ...lines,
    [],
    ["", file.due, rupeesOf(statement.due)],
    ...paid,
  ]);
}

/** Every partner's month, a row each. */
export function monthCsv(statements: readonly PartnerStatement[]): string {
  return csvText([
    copy.monthFile,
    ...statements.map((each) => [
      each.name,
      each.code,
      String(each.fitted),
      rupeesOf(each.earned),
      rupeesOf(each.taken_back_amount),
      rupeesOf(each.due),
      each.payout === null ? "" : rupeesOf(each.payout.amount),
      each.payout?.paid_on ?? "",
      each.payout?.reference ?? "",
      rupeesOf(each.owed),
    ]),
  ]);
}
