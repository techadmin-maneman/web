// Operations · Purchasing, its claims (docs/decisions/0169-supplier-claims.md): every open claim on a supplier and the
// latest settled, each opened beneath the list for its next step; then the returned pieces handed in to settle.

import { Toast } from "@maneman/ui/Toast";
import { Panel } from "@maneman/ui/Panel";
import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Note } from "@maneman/ui/Note";
import { FIGURE, Table } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { inCurrency } from "@maneman/web-kit/money";
import { useState } from "react";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "@maneman/ui/forms.module.css";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { ClaimSteps, type ClaimAnswer } from "./ClaimSteps.tsx";
import { ReturnedPieces } from "./ReturnedPieces.tsx";
import type { Claim, SupplierClaims, Orders } from "./types.ts";
import { Refusal } from "@maneman/ui/Refusal";
import { RowHead } from "@maneman/ui/RowHead";
import { purchasingApi } from "./purchasing-api.ts";

const loadClaims = () => purchasingApi.claims();

/** What a claim is worth: the credit given, else what was claimed at the order's price. */
const valueOf = (claim: Claim) => inCurrency(claim.credit_amount ?? claim.unit_price * claim.quantity, claim.currency);

/** Where a claim stands in words: its outcome once settled, else its state. */
const standingOf = (claim: Claim) =>
  claim.outcome === null ? copy.claims.states[claim.state] : copy.claims.outcomes[claim.outcome];

function ClaimsTable({
  claims,
  supplierOf,
  onOpen,
}: {
  claims: SupplierClaims;
  supplierOf: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  const [number, supplier, item, reason, status, value] = copy.claims.columns;
  const columns: readonly Column<Claim>[] = [
    { label: number, sort: (claim) => claim.number },
    {
      label: supplier,
      sort: (claim) => supplierOf(claim.supplier_id),
      choice: (claim) => supplierOf(claim.supplier_id),
    },
    { label: item, sort: (claim) => claim.name },
    {
      label: reason,
      sort: (claim) => copy.claims.reasons[claim.reason],
      choice: (claim) => copy.claims.reasons[claim.reason],
    },
    { label: status, sort: standingOf, choice: standingOf },
    { label: value, sort: (claim) => claim.credit_amount ?? claim.unit_price * claim.quantity, figure: true },
  ];
  const view = useTableView(claims.claims, columns, {
    search: (claim) => `${copy.claims.number(claim.number)} ${claim.name} ${claim.piece_code ?? ""}`,
  });
  if (claims.claims.length === 0) return <EmptyState look="panel" line={copy.claims.none} />;
  return (
    <>
      <Narrowing view={view} label={copy.claims.find} />
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((claim) => (
            <tr key={claim.id}>
              <RowHead>
                <TextButton
                  compact
                  aria-label={copy.claims.open(copy.claims.number(claim.number))}
                  onClick={() => {
                    onOpen(claim.id);
                  }}
                >
                  {copy.claims.number(claim.number)}
                </TextButton>
              </RowHead>
              <td>{supplierOf(claim.supplier_id)}</td>
              <td>{copy.claims.item(claim.name, claim.quantity, claim.piece_code)}</td>
              <td>{copy.claims.reasons[claim.reason]}</td>
              <td>{standingOf(claim)}</td>
              <td className={FIGURE}>{valueOf(claim)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
  );
}

export function Claims({ orders }: { orders: Orders }) {
  const [loaded, retry] = useLoad(loadClaims);
  const [claims, setClaims] = useState<SupplierClaims | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const current = claims ?? (loaded.state === "loaded" ? loaded.value : null);
  const supplierOf = (id: string) => orders.suppliers.find((each) => each.id === id)?.name ?? id;
  const answered = (answer: ClaimAnswer, words: string) => {
    if (answer.ok) {
      setClaims(answer.body);
      setSaid(words);
      setFailure(null);
    } else setFailure({ code: answer.code, fields: answer.fields });
  };
  const opened = current?.claims.find((each) => each.id === open) ?? null;
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  if (current === null) return null;
  return (
    <>
      <Panel titleId="claims" title={copy.claims.title}>
        <ClaimsTable claims={current} supplierOf={supplierOf} onOpen={setOpen} />
        {opened !== null && (
          <div className={form.group}>
            <Note>
              {copy.claims.number(opened.number)} · {copy.claims.from(copy.number(opened.order_number))}
              {opened.note !== null && ` · ${opened.note}`}
            </Note>
            {opened.photo_id !== null && (
              <Note>
                <TextLink href={`/api/stock-photos/${opened.photo_id}`} newTab>
                  {copy.photo.view}
                </TextLink>
              </Note>
            )}
            <ClaimSteps key={opened.id} claim={opened} onAnswer={answered} />
          </div>
        )}
        {said !== null && <Toast>{said}</Toast>}
        {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
      </Panel>
      <Panel titleId="returned-pieces" title={copy.returns.title}>
        <ReturnedPieces pieces={current.returns} onAnswer={answered} />
      </Panel>
    </>
  );
}
