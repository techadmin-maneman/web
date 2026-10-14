// What a printed purchase order says of us (docs/decisions/0166-purchase-orders.md): the legal name, the GSTIN and where
// the supplier delivers, which a manager sets once and each printed order carries.

import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, TextArea, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { purchasing } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { FormActions } from "../components/FormActions.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { useWrite } from "../lib/write.ts";
import type { Orders } from "./types.ts";
import { purchasingApi } from "./purchasing-api.ts";

const copy = purchasing.letterhead;

export function Letterhead({ orders, onSaved }: { orders: Orders; onSaved: (next: Orders, said: string) => void }) {
  const set = orders.letterhead;
  const [legalName, setLegalName] = useState(set?.legal_name ?? "");
  const [gstin, setGstin] = useState(set?.gstin ?? "");
  const [deliverTo, setDeliverTo] = useState(set?.deliver_to ?? "");
  const write = useWrite<Orders>((next) => {
    onSaved(next, copy.saved);
  });
  const refused = (field: string) =>
    write.failure?.fields?.includes(field) === true ? errorText(copy.errors, write.failure) : null;

  return (
    <Panel titleId="letterhead" title={copy.title}>
      <p className={form.note}>{set === null ? copy.missing : copy.intro}</p>
      <form
        className={form.group}
        onSubmit={(event) => {
          event.preventDefault();
          const body = { legal_name: legalName, gstin: gstin.trim() === "" ? null : gstin, deliver_to: deliverTo };
          void write.send(() => purchasingApi.setLetterhead(body));
        }}
      >
        <Field label={copy.legalName} error={refused("legal_name")} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              value={legalName}
              maxLength={120}
              onChange={(event) => {
                setLegalName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={copy.gstin} error={refused("gstin")} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              value={gstin}
              maxLength={15}
              onChange={(event) => {
                setGstin(event.target.value.toUpperCase());
              }}
            />
          )}
        </Field>
        <Field label={copy.deliverTo} hint={copy.deliverHint} error={refused("deliver_to")} className={form.field}>
          {(control) => (
            <TextArea
              {...control}
              value={deliverTo}
              maxLength={400}
              rows={4}
              onChange={(event) => {
                setDeliverTo(event.target.value);
              }}
            />
          )}
        </Field>
        {write.failure !== null && write.failure.fields === undefined && (
          <Refusal className={form.error} said={errorText(copy.errors, write.failure)} />
        )}
        <FormActions>
          <Button
            variant="primary"
            size="small"
            type="submit"
            disabled={write.busy || legalName.trim() === "" || deliverTo.trim() === ""}
          >
            {copy.save}
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}
