// Operations · Purchasing, its claims (docs/decisions/0169-supplier-claims.md): every open claim on a supplier and the
// latest settled, each opened beneath the list for its next step; then the returned pieces handed in to settle.

import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { inCurrency } from "@maneman/web-kit/money";
import { useState } from "react";
import { client } from "../api.ts";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ClaimSteps, type ClaimAnswer } from "./ClaimSteps.tsx";
import { ReturnedPieces } from "./ReturnedPieces.tsx";
import type { Claim, ClaimsBook, Orders } from "./types.ts";

const loadClaims = () => client.get("/api/supplier-claims");

/** What a claim is worth: the credit given, else what was claimed at the order's price. */
const valueOf = (claim: Claim) => inCurrency(claim.credit_amount ?? claim.unit_price * claim.quantity, claim.currency);

function ClaimsTable({
  book,
  supplierOf,
  onOpen,
}: {
  book: ClaimsBook;
  supplierOf: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  if (book.claims.length === 0) return <p className={form.note}>{copy.claims.none}</p>;
  return (
    <Table className={form.table}>
      <thead>
        <tr>
          {copy.claims.columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {book.claims.map((claim) => (
          <tr key={claim.id}>
            <th scope="row" className={form.rowHead}>
              <button
                className={form.inline}
                type="button"
                aria-label={copy.claims.open(copy.claims.number(claim.number))}
                onClick={() => {
                  onOpen(claim.id);
                }}
              >
                {copy.claims.number(claim.number)}
              </button>
            </th>
            <td>{supplierOf(claim.supplier_id)}</td>
            <td>{copy.claims.item(claim.name, claim.quantity, claim.piece_code)}</td>
            <td>{copy.claims.reasons[claim.reason] ?? claim.reason}</td>
            <td>
              {claim.outcome === null
                ? (copy.claims.states[claim.state] ?? claim.state)
                : (copy.claims.outcomes[claim.outcome] ?? claim.outcome)}
            </td>
            <td className={form.figure}>{valueOf(claim)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function Claims({ orders }: { orders: Orders }) {
  const [loaded, retry] = useLoad(loadClaims);
  const [book, setBook] = useState<ClaimsBook | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const current = book ?? (loaded.state === "loaded" ? loaded.value : null);
  const supplierOf = (id: string) => orders.suppliers.find((each) => each.id === id)?.name ?? id;
  const answered = (answer: ClaimAnswer, words: string) => {
    if (answer.ok) {
      setBook(answer.body);
      setSaid(words);
      setFailure(null);
    } else setFailure({ code: answer.code, fields: answer.fields });
  };
  const opened = current?.claims.find((each) => each.id === open) ?? null;
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  if (current === null) return null;
  return (
    <>
      <section className={form.panel} aria-labelledby="claims">
        <div className={form.panelHead}>
          <h2 className={form.panelTitle} id="claims">
            {copy.claims.title}
          </h2>
        </div>
        <ClaimsTable book={current} supplierOf={supplierOf} onOpen={setOpen} />
        {opened !== null && (
          <div className={form.group}>
            <p className={form.note}>
              {copy.claims.number(opened.number)} · {copy.claims.from(copy.number(opened.order_number))}
              {opened.note !== null && ` · ${opened.note}`}
            </p>
            {opened.photo_id !== null && (
              <p className={form.note}>
                <a href={`/api/stock-photos/${opened.photo_id}`} target="_blank" rel="noreferrer">
                  {copy.photo.view}
                </a>
              </p>
            )}
            <ClaimSteps key={opened.id} claim={opened} onAnswer={answered} />
          </div>
        )}
        {said !== null && (
          <p className={form.saved} role="status">
            {said}
          </p>
        )}
        {failure !== null && (
          <p className={form.error} role="alert">
            {errorText(copy.errors, failure)}
          </p>
        )}
      </section>
      <section className={form.panel} aria-labelledby="returned-pieces">
        <div className={form.panelHead}>
          <h2 className={form.panelTitle} id="returned-pieces">
            {copy.returns.title}
          </h2>
        </div>
        <ReturnedPieces pieces={current.returns} onAnswer={answered} />
      </section>
    </>
  );
}
