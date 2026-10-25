// Money · Payments: Finance's ledger. Every payment over the days chosen, the newest first, found by client or
// reference, with where Books stands with each, and the whole list saved as a CSV; and the payment links still unpaid
// (src/domain/money/payment-ledger.ts).

import { Button } from "@maneman/ui/Button";
import { DateInput, Field } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useLoad } from "@maneman/ui/useLoad";
import { addDays, fullDate, indiaDate, todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import { useHeaderSub } from "../components/PageHead.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import form from "../components/forms.module.css";
import { ledger as copy } from "../content/ledger.ts";
import { csvText } from "../lib/csv.ts";
import { saveFile } from "../lib/save-file.ts";
import styles from "./ledger.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ledgerApi, type Ledger } from "./ledger-api.ts";

type Payment = Ledger["payments"][number];
type Link = Ledger["unpaid_links"][number];

const dayOf = (at: string) => indiaDate(at);
const nameOf = (row: { person: { name: string } | null }) => row.person?.name ?? copy.noClient;
const wordOf = (words: Readonly<Record<string, string | undefined>>, key: string | null) =>
  key === null ? copy.noClient : (words[key] ?? key);

/** A payment's cells, as the table shows them and the CSV keeps them. */
const cellsOf = (row: Payment): string[] => [
  fullDate(dayOf(row.created_at)),
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
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
      <TableEnd view={view} />
    </Panel>
  );
}

function linkState(link: Link, now: number): string {
  if (link.refused_at !== null) return copy.links.states.refused;
  if (link.closes_at !== null && Date.parse(link.closes_at) <= now) return copy.links.states.closed;
  return link.sent_at === null ? copy.links.states.unsent : copy.links.states.sent;
}

function Links({ links }: { links: readonly Link[] }) {
  const now = Date.now();
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
                  <RowHead>{fullDate(dayOf(link.created_at))}</RowHead>
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
  useHeaderSub(copy.counted(fullDate(ledger.from), fullDate(ledger.to)));
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
  const today = todayInIndia(Date.now());
  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const read = useCallback(() => ledgerApi.ledger(from, to <= from ? from : to), [from, to]);
  const [loaded, retry] = useLoad(read);
  return (
    <div className={form.screen}>
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
        {loaded.state === "loaded" && (
          <Button
            variant="outline"
            size="small"
            onClick={() => {
              exportCsv(loaded.value);
            }}
          >
            {copy.export}
          </Button>
        )}
      </Toolbar>
      {loaded.state === "loading" && <Loading />}
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
