// One claim's next steps (docs/decisions/0169-supplier-claims.md): a drafted claim marked sent, with a note, or
// withdrawn with why; a sent claim settled by the supplier's answer, a credit of so much, a replacement or a refusal.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import { StockPhoto } from "./StockPhoto.tsx";
import type { Claim } from "./types.ts";
import { paiseFromRupees } from "@maneman/web-kit/money";
import { FormActions } from "../components/FormActions.tsx";
import { purchasingApi } from "./purchasing-api.ts";

export type ClaimAnswer = Awaited<ReturnType<typeof purchasingApi.sendClaim>>;

/** The claim's whole value in its currency's main unit, as the credit box starts: "250.00" for 25,000 cents. */
const wholeValue = (claim: Claim) => ((claim.unit_price * claim.quantity) / 100).toFixed(2);

/** Withdrawing a drafted claim: asked first, then sent with why. */
function Withdraw({
  claim,
  note,
  withdrawing,
  onWithdrawing,
  onAnswer,
}: {
  claim: Claim;
  note: string;
  withdrawing: boolean;
  onWithdrawing: (withdrawing: boolean) => void;
  onAnswer: (answer: ClaimAnswer, said: string) => void;
}) {
  if (!withdrawing) {
    return (
      <Button
        variant="outline"
        size="small"
        onClick={() => {
          onWithdrawing(true);
        }}
      >
        {copy.claims.withdraw}
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="destructive"
        size="small"
        disabled={note === ""}
        onClick={() =>
          void purchasingApi.withdrawClaim(claim.id, note).then((answer) => {
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
          onWithdrawing(false);
        }}
      >
        {copy.claims.keep}
      </Button>
    </>
  );
}

function Drafted({ claim, onAnswer }: { claim: Claim; onAnswer: (answer: ClaimAnswer, said: string) => void }) {
  const access = useAccess();
  const [note, setNote] = useState("");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
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
      {!withdrawing && <StockPhoto label={copy.photo.claim} photoId={photoId} onPhoto={setPhotoId} />}
      <FormActions>
        {!withdrawing && access.mayCall("POST /api/supplier-claims/{id}/send") && (
          <Button
            variant="primary"
            size="small"
            onClick={() =>
              void purchasingApi
                .sendClaim(claim.id, { note: said === "" ? null : said, photo_id: photoId })
                .then((answer) => {
                  onAnswer(answer, copy.claims.sentSaid);
                })
            }
          >
            {copy.claims.send}
          </Button>
        )}
        {access.mayCall("POST /api/supplier-claims/{id}/withdraw") && (
          <Withdraw
            claim={claim}
            note={said}
            withdrawing={withdrawing}
            onWithdrawing={setWithdrawing}
            onAnswer={onAnswer}
          />
        )}
      </FormActions>
    </div>
  );
}

function Sent({ claim, onAnswer }: { claim: Claim; onAnswer: (answer: ClaimAnswer, said: string) => void }) {
  const [credit, setCredit] = useState(wholeValue(claim));
  const [note, setNote] = useState("");
  const amount = paiseFromRupees(credit);
  const decide = async (outcome: "credit" | "replacement" | "rejected") => {
    const said = note.trim();
    const body = { outcome, credit_amount: outcome === "credit" ? amount : null, note: said === "" ? null : said };
    onAnswer(await purchasingApi.decideClaim(claim.id, body), copy.claims.settledSaid);
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
      <FormActions>
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
      </FormActions>
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
