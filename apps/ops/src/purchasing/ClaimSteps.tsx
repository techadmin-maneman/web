// One claim's next steps (docs/decisions/0169-supplier-claims.md): a drafted claim marked sent, with a note, or
// withdrawn with why; a sent claim settled by the supplier's answer, a credit of so much, a replacement or a refusal.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { client } from "../api.ts";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import type { Claim } from "./types.ts";

export type ClaimAnswer = Awaited<ReturnType<typeof client.post<"/api/supplier-claims/{id}/send">>>;

/** The claim's whole value in its currency's main unit, as the credit box starts: "250.00" for 25,000 cents. */
const wholeValue = (claim: Claim) => ((claim.unit_price * claim.quantity) / 100).toFixed(2);

function Drafted({ claim, onAnswer }: { claim: Claim; onAnswer: (answer: ClaimAnswer, said: string) => void }) {
  const access = useAccess();
  const [note, setNote] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const path = { path: { id: claim.id } };
  const said = note.trim();
  return (
    <div className={form.group}>
      <Field label={withdrawing ? copy.claims.why : copy.claims.note} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            maxLength={200}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={form.actions}>
        {!withdrawing && access.mayCall("POST /api/supplier-claims/{id}/send") && (
          <Button
            variant="primary"
            size="small"
            onClick={() =>
              void client
                .post("/api/supplier-claims/{id}/send", { ...path, body: { note: said === "" ? null : said } })
                .then((answer) => {
                  onAnswer(answer, copy.claims.sentSaid);
                })
            }
          >
            {copy.claims.send}
          </Button>
        )}
        {access.mayCall("POST /api/supplier-claims/{id}/withdraw") &&
          (withdrawing ? (
            <>
              <Button
                variant="destructive"
                size="small"
                disabled={said === ""}
                onClick={() =>
                  void client
                    .post("/api/supplier-claims/{id}/withdraw", { ...path, body: { note: said } })
                    .then((answer) => {
                      onAnswer(answer, copy.claims.withdrawnSaid);
                    })
                }
              >
                {copy.claims.confirmWithdraw}
              </Button>
              <Button
                variant="outline"
                size="small"
                onClick={() => {
                  setWithdrawing(false);
                }}
              >
                {copy.claims.keep}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="small"
              onClick={() => {
                setWithdrawing(true);
              }}
            >
              {copy.claims.withdraw}
            </Button>
          ))}
      </div>
    </div>
  );
}

function Sent({ claim, onAnswer }: { claim: Claim; onAnswer: (answer: ClaimAnswer, said: string) => void }) {
  const [credit, setCredit] = useState(wholeValue(claim));
  const [note, setNote] = useState("");
  const amount = Math.round(Number(credit) * 100);
  const decide = async (outcome: "credit" | "replacement" | "rejected") => {
    const said = note.trim();
    const body = { outcome, credit_amount: outcome === "credit" ? amount : null, note: said === "" ? null : said };
    onAnswer(
      await client.post("/api/supplier-claims/{id}/decide", { path: { id: claim.id }, body }),
      copy.claims.settledSaid,
    );
  };
  return (
    <div className={form.group}>
      <Field label={copy.claims.credit(claim.currency)} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            inputMode="decimal"
            value={credit}
            onChange={(event) => {
              setCredit(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.claims.note} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            maxLength={200}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={form.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={!Number.isFinite(amount) || amount < 1}
          onClick={() => void decide("credit")}
        >
          {copy.claims.credited}
        </Button>
        <Button variant="outline" size="small" onClick={() => void decide("replacement")}>
          {copy.claims.replaced}
        </Button>
        <Button variant="outline" size="small" onClick={() => void decide("rejected")}>
          {copy.claims.rejected}
        </Button>
      </div>
    </div>
  );
}

export function ClaimSteps({
  claim,
  onAnswer,
}: {
  claim: Claim;
  onAnswer: (answer: ClaimAnswer, said: string) => void;
}) {
  const access = useAccess();
  if (claim.state === "drafted") return <Drafted claim={claim} onAnswer={onAnswer} />;
  if (claim.state === "sent" && access.mayCall("POST /api/supplier-claims/{id}/decide")) {
    return <Sent claim={claim} onAnswer={onAnswer} />;
  }
  return null;
}
