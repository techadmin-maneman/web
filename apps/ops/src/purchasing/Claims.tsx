// Operations · Purchasing, its claims (docs/decisions/0169-supplier-claims.md): every open claim on a supplier and the
// latest settled, each opened beneath the list for its next step; then the returned pieces handed in to settle.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { TextLink } from "@maneman/ui/TextLink";
import { RowButton } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { inCurrency } from "@maneman/web-kit/money";
import { useState } from "react";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ClaimSteps, type ClaimAnswer } from "./ClaimSteps.tsx";
import { ReturnedPieces } from "./ReturnedPieces.tsx";
import type { Claim, SupplierClaims, Orders } from "./types.ts";
import { Refusal } from "../components/Refusal.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { purchasingApi } from "./purchasing-api.ts";

const loadClaims = () => purchasingApi.claims();

/** What a claim is worth: the credit given, else what was claimed at the order's price. */
const valueOf = (claim: Claim) => inCurrency(claim.credit_amount ?? claim.unit_price * claim.quantity, claim.currency);

function ClaimsTable({
  claims,
  supplierOf,
  onOpen,
}: {
  claims: SupplierClaims;
  supplierOf: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  if (claims.claims.length === 0) return <Note>{copy.claims.none}</Note>;
  return (
    <Table controls>
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
        {claims.claims.map((claim) => (
          <tr key={claim.id}>
            <RowHead>
              <RowButton
                beside
                aria-label={copy.claims.open(copy.claims.number(claim.number))}
                onClick={() => {
                  onOpen(claim.id);
                }}
              >
                {copy.claims.number(claim.number)}
              </RowButton>
            </RowHead>
            <td>{supplierOf(claim.supplier_id)}</td>
            <td>{copy.claims.item(claim.name, claim.quantity, claim.piece_code)}</td>
            <td>{copy.claims.reasons[claim.reason]}</td>
            <td>{claim.outcome === null ? copy.claims.states[claim.state] : copy.claims.outcomes[claim.outcome]}</td>
            <td className={form.figure}>{valueOf(claim)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
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
  if (loaded.state === "loading") return <Loading />;
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
        {said !== null && (
          <InlineMessage tone="saved" className={form.saved}>
            {said}
          </InlineMessage>
        )}
        {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
      </Panel>
      <Panel titleId="returned-pieces" title={copy.returns.title}>
        <ReturnedPieces pieces={current.returns} onAnswer={answered} />
      </Panel>
    </>
  );
}
