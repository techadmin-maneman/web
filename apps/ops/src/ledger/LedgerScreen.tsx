// Money · Payments: Finance's ledger. Every payment over the days chosen, the newest first, found by client or
// reference, with where Books stands with each, and the whole list saved as a CSV; and the payment links still unpaid
// (src/domain/money/payment-ledger.ts).

import { Button } from "@maneman/ui/Button";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { NoValue } from "@maneman/ui/NoValue";
import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { plainDate } from "@maneman/web-kit/plain-date";
import { DateInput, Field } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useLoad } from "@maneman/ui/useLoad";
import { addDays, indiaDate, todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { type ReactNode, useCallback, useState } from "react";
import { PageActions, useHeaderSub } from "../frame/PageHead.tsx";
import { useCity } from "../lib/city.ts";
import { MoneyFigures } from "./MoneyFigures.tsx";
import { RowHead } from "@maneman/ui/RowHead";
import { RefundPayment } from "../clients/index.ts";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import form from "@maneman/ui/forms.module.css";
import { ledger as copy } from "../content/ledger.ts";
import { csvText } from "../lib/csv.ts";
import { saveFile } from "../lib/save-file.ts";
import styles from "./ledger.module.css";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { ledgerApi, type Ledger } from "./ledger-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

type Payment = Ledger["payments"][number];
type Link = Ledger["unpaid_links"][number];

const dayOf = (at: string) => indiaDate(at);
const nameOf = (row: { person: { name: string } | null }) => row.person?.name ?? copy.noClient;
const wordOf = (words: Readonly<Record<string, string | undefined>>, key: string | null) =>
  key === null ? copy.noClient : (words[key] ?? key);

/** A payment's cells, as the table shows them and the CSV keeps them. */
const cellsOf = (row: Payment): string[] => [
  plainDate(dayOf(row.created_at)),
  row.reference ?? copy.noClient,
  nameOf(row),
  wordOf(copy.kinds, row.kind),
  wordOf(copy.methods, row.method),
  rupees(row.amount),
  row.refunded_amount === 0 ? copy.noClient : rupees(row.refunded_amount),
  wordOf(copy.statuses, row.status),
  copy.books[row.books],
];

const FIGURES = new Set([5, 6]);

/** What a column sorts by: the date and the amount as themselves, the rest by their words. */
function sortOf(at: number): (row: Payment) => string | number {
  if (at === 0) return (row) => row.created_at;
  if (at === 5) return (row) => row.amount;
  return (row) => cellsOf(row)[at] ?? "";
}

const COLUMNS: readonly Column<Payment>[] = copy.payments.columns.map((label, at) => ({
  label,
  figure: FIGURES.has(at),
  sort: sortOf(at),
  ...(at === 7 || at === 8 ? { choice: (row: Payment) => cellsOf(row)[at] ?? "" } : {}),
}));

/** The Status and Books columns, each a state in its tone; the CSV keeps their words. */
const STATUS = 7;
const BOOKS = 8;

const STATUS_TONES: Readonly<Record<string, BadgeTone | undefined>> = {
  authorized: "attention",
  captured: "done",
  failed: "error",
  refunded: "neutral",
  partially_refunded: "neutral",
};

/** A cell as the table shows it: a state as a badge, a gap as a dash, the rest as the CSV words it. */
function shown(row: Payment, at: number, words: string): ReactNode {
  if (words === copy.noClient) return <NoValue />;
  if (at === STATUS) return <Badge tone={STATUS_TONES[row.status] ?? "neutral"}>{words}</Badge>;
  if (at === BOOKS && row.books !== "none") {
    return <Badge tone={row.books === "applied" ? "done" : "attention"}>{words}</Badge>;
  }
  return words;
}

function Payments({ ledger }: { ledger: Ledger }) {
  const view = useTableView(ledger.payments, COLUMNS, { search: (row) => `${nameOf(row)} ${row.reference ?? ""}` });
  return (
    <Panel titleId="ledger-payments" title={copy.payments.title}>
      <Narrowing view={view} label={copy.narrow} />
      {ledger.more && <Note>{copy.payments.more(ledger.payments.length)}</Note>}
      <TableScroll labelledBy="ledger-payments">
        <Table>
          <thead>
            <tr>
              <SortHeads view={view} />
              <th scope="col">
                <VisuallyHidden>{copy.payments.refund}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.shown.map((row) => {
              const [date, ...rest] = cellsOf(row);
              return (
                <tr key={row.id}>
                  <RowHead>{date}</RowHead>
                  {rest.map((cell, at) => (
                    <td key={copy.payments.columns[at + 1]} className={FIGURES.has(at + 1) ? styles.figure : undefined}>
                      {shown(row, at + 1, cell)}
                    </td>
                  ))}
                  {/* Finance give back what is left of a payment here, without opening the client's page. */}
                  <td>
                    <RefundPayment entry={row} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
      <TableEnd view={view} empty={copy.noneInRange} />
    </Panel>
  );
}

function linkState(link: Link, now: number): string {
  if (link.refused_at !== null) return copy.links.states.refused;
  if (link.closes_at !== null && Date.parse(link.closes_at) <= now) return copy.links.states.closed;
  return link.sent_at === null ? copy.links.states.unsent : copy.links.states.sent;
}

function Links({ links }: { links: readonly Link[] }) {
  const now = apiNow();
  return (
    <Panel titleId="ledger-links" title={copy.links.title}>
      {links.length === 0 ? (
        <Note>{copy.links.none}</Note>
      ) : (
        <TableScroll labelledBy="ledger-links">
          <Table>
            <thead>
              <tr>
                {copy.links.columns.map((column, at) => (
                  <th key={column} scope="col" className={at === 3 ? styles.figure : undefined}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id}>
                  <RowHead>{plainDate(dayOf(link.created_at))}</RowHead>
                  <td>{link.reference ?? copy.noClient}</td>
                  <td>{nameOf(link)}</td>
                  <td className={styles.figure}>{rupees(link.amount)}</td>
                  <td>{linkState(link, now)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}

function Counted({ ledger }: { ledger: Ledger }) {
  useHeaderSub(copy.counted(plainDate(ledger.from), plainDate(ledger.to)));
  return null;
}

/** The days' payments as a file: the table's columns, every payment listed, whatever the search. */
function exportCsv(ledger: Ledger) {
  saveFile(
    copy.fileName(ledger.from, ledger.to),
    csvText([copy.payments.columns, ...ledger.payments.map(cellsOf)]),
    "text/csv",
  );
}

export function LedgerScreen() {
  const today = todayInIndia(apiNow());
  const { city } = useCity();
  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const read = useCallback(() => ledgerApi.ledger(from, to <= from ? from : to, city), [from, to, city]);
  const [loaded, retry] = useLoad(read);
  return (
    <div className={form.screen}>
      <MoneyFigures />
      <Toolbar label={copy.title}>
        <Field label={copy.from}>
          {(control) => (
            <DateInput
              {...control}
              value={from}
              max={today}
              onChange={(event) => {
                if (event.target.value !== "") setFrom(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={copy.to}>
          {(control) => (
            <DateInput
              {...control}
              value={to}
              max={today}
              onChange={(event) => {
                if (event.target.value !== "") setTo(event.target.value);
              }}
            />
          )}
        </Field>
      </Toolbar>
      {loaded.state === "loaded" && (
        <PageActions>
          <Button
            variant="outline"
            size="small"
            onClick={() => {
              exportCsv(loaded.value);
            }}
          >
            {copy.export}
          </Button>
        </PageActions>
      )}
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <>
          <Counted ledger={loaded.value} />
          <Payments ledger={loaded.value} />
          <Links links={loaded.value.unpaid_links} />
        </>
      )}
    </div>
  );
}
