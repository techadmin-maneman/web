// One line of the supply plan (docs/decisions/0180-supply-plan.md): approved at the quantity ops leave in its box, or
// rejected with why; once decided, what came of it.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { supplyPlan as copy } from "../content/supply-plan.ts";
import { useAccess } from "../lib/access.ts";

export type Plan = paths["/api/supply-plan"]["get"]["responses"][200]["content"]["application/json"];
export type Line = Plan["lines"][number];

/** What a decision answered: the whole plan, or the refusal. */
export type Answer =
  | { readonly ok: true; readonly body: Plan }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

function Decided({ line }: { line: Line }) {
  const state = copy.states[line.state] ?? line.state;
  if (line.state === "approved" && line.po_number !== null) return <>{`${state} · ${copy.order(line.po_number)}`}</>;
  if (line.state === "rejected" && line.reject_reason !== null) return <>{`${state} · ${line.reject_reason}`}</>;
  return <>{state}</>;
}

/** A line rejected, with why. */
function Reject({
  line,
  onAnswer,
  onKeep,
}: {
  line: Line;
  onAnswer: (answer: Answer, said: string) => void;
  onKeep: () => void;
}) {
  const [reason, setReason] = useState("");
  const path = { path: { id: line.id } };
  return (
    <div className={form.group}>
      <Field label={copy.why_label} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            maxLength={200}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={form.actions}>
        <Button
          variant="destructive"
          size="small"
          disabled={reason.trim() === ""}
          onClick={() =>
            void client
              .post("/api/supply-plan/lines/{id}/reject", { ...path, body: { reason: reason.trim() } })
              .then((answer) => {
                onAnswer(answer, copy.rejectedSaid);
              })
          }
        >
          {copy.confirmReject}
        </Button>
        <Button variant="outline" size="small" onClick={onKeep}>
          {copy.keep}
        </Button>
      </div>
    </div>
  );
}

export function PlanLineSteps({ line, onAnswer }: { line: Line; onAnswer: (answer: Answer, said: string) => void }) {
  const access = useAccess();
  const [quantity, setQuantity] = useState(String(line.proposed));
  const [rejecting, setRejecting] = useState(false);
  if (line.state !== "proposed") return <Decided line={line} />;
  if (!access.mayCall("POST /api/supply-plan/lines/{id}/approve")) return null;
  const path = { path: { id: line.id } };
  const count = Number(quantity);
  if (rejecting) {
    return (
      <Reject
        line={line}
        onAnswer={onAnswer}
        onKeep={() => {
          setRejecting(false);
        }}
      />
    );
  }
  return (
    <div className={form.actions}>
      <Field label={copy.quantity(line.name)} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
          />
        )}
      </Field>
      <Button
        variant="primary"
        size="small"
        disabled={!Number.isInteger(count) || count < 1}
        onClick={() =>
          void client
            .post("/api/supply-plan/lines/{id}/approve", { ...path, body: { quantity: count } })
            .then((answer) => {
              onAnswer(answer, copy.approvedSaid);
            })
        }
      >
        {copy.approve}
      </Button>
      <Button
        variant="outline"
        size="small"
        onClick={() => {
          setRejecting(true);
        }}
      >
        {copy.reject}
      </Button>
    </div>
  );
}
