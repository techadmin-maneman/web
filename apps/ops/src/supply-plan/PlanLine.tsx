// One line of the supply plan (docs/decisions/0180-supply-plan.md): approved at the quantity ops leave in its box, or
// rejected with why; once decided, what came of it.

import type { Success } from "@maneman/web-kit/api";
import { Badge } from "@maneman/ui/Badge";
import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { supplyPlanApi } from "./supply-plan-api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { supplyPlan as copy } from "../content/supply-plan.ts";
import { useAccess } from "../lib/access.ts";
import { FormActions } from "../components/FormActions.tsx";

export type Plan = Success<paths["/api/supply-plan"]["get"]>;
export type Line = Plan["lines"][number];

/** What a decision answered: the whole plan, or the refusal. */
export type Answer =
  | { readonly ok: true; readonly body: Plan }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

function Decided({ line, decided }: { line: Line; decided: Exclude<Line["state"], "proposed"> }) {
  const state = copy.states[decided];
  if (decided === "approved" && line.po_number !== null) return <>{copy.draftedAs(copy.order(line.po_number))}</>;
  if (decided === "rejected" && line.reject_reason !== null) return <>{`${state} · ${line.reject_reason}`}</>;
  return <>{state}</>;
}

/** Where a line stands, in its row: still to decide, or what came of it. */
export function LineState({ line }: { line: Line }) {
  if (line.state === "proposed") return <Badge tone="attention">{copy.states.proposed}</Badge>;
  return <Decided line={line} decided={line.state} />;
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
      <FormActions>
        <Button
          variant="danger"
          size="small"
          disabled={reason.trim() === ""}
          onClick={() =>
            void supplyPlanApi.rejectLine(line.id, reason.trim()).then((answer) => {
              onAnswer(answer, copy.rejectedSaid);
            })
          }
        >
          {copy.confirmReject}
        </Button>
        <Button variant="outline" size="small" onClick={onKeep}>
          {copy.keep}
        </Button>
      </FormActions>
    </div>
  );
}

export function PlanLineSteps({ line, onAnswer }: { line: Line; onAnswer: (answer: Answer, said: string) => void }) {
  const access = useAccess();
  const [quantity, setQuantity] = useState(String(line.proposed));
  const [rejecting, setRejecting] = useState(false);
  if (line.state !== "proposed") return <Decided line={line} decided={line.state} />;
  if (!access.mayCall("POST /api/supply-plan/lines/{id}/approve")) return null;
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
    <FormActions>
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
          void supplyPlanApi.approveLine(line.id, count).then((answer) => {
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
    </FormActions>
  );
}
