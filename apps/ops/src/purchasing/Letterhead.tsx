// What a printed purchase order says of us (docs/decisions/0166-purchase-orders.md): the legal name, the registered
// office and CIN, the GSTIN and where the supplier delivers, which a manager sets once and each printed order carries.

import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, TextArea, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
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

/** One of the letterhead's boxes: a line, in capitals for a number, or an address of a few lines. */
function Box(props: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly refused: string | null;
  readonly maxLength: number;
  readonly lines?: number;
  readonly capitals?: boolean;
}) {
  const given = (value: string) => {
    props.onValue(props.capitals === true ? value.toUpperCase() : value);
  };
  return (
    <Field label={props.label} hint={props.hint} error={props.refused} className={form.field}>
      {(control) =>
        props.lines === undefined ? (
          <TextInput
            {...control}
            value={props.value}
            maxLength={props.maxLength}
            onChange={(event) => {
              given(event.target.value);
            }}
          />
        ) : (
          <TextArea
            {...control}
            value={props.value}
            maxLength={props.maxLength}
            rows={props.lines}
            onChange={(event) => {
              given(event.target.value);
            }}
          />
        )
      }
    </Field>
  );
}

/** A box left empty is sent as nothing to print. */
const given = (text: string) => (text.trim() === "" ? null : text);

export function Letterhead({ orders, onSaved }: { orders: Orders; onSaved: (next: Orders, said: string) => void }) {
  const set = orders.letterhead;
  const [legalName, setLegalName] = useState(set?.legal_name ?? "");
  const [office, setOffice] = useState(set?.registered_office ?? "");
  const [cin, setCin] = useState(set?.cin ?? "");
  const [gstin, setGstin] = useState(set?.gstin ?? "");
  const [deliverTo, setDeliverTo] = useState(set?.deliver_to ?? "");
  const write = useWrite<Orders>((next) => {
    onSaved(next, copy.saved);
  });
  const refused = (field: string) =>
    write.failure?.fields?.includes(field) === true ? errorText(copy.errors, write.failure) : null;

  return (
    <Panel titleId="letterhead" title={copy.title}>
      <Note>{set === null ? copy.missing : copy.intro}</Note>
      <form
        className={form.group}
        onSubmit={(event) => {
          event.preventDefault();
          const body = {
            legal_name: legalName,
            registered_office: given(office),
            cin: given(cin),
            gstin: given(gstin),
            deliver_to: deliverTo,
          };
          void write.send(() => purchasingApi.setLetterhead(body));
        }}
      >
        <Box
          label={copy.legalName}
          value={legalName}
          onValue={setLegalName}
          refused={refused("legal_name")}
          maxLength={120}
        />
        <Box
          label={copy.registeredOffice}
          value={office}
          onValue={setOffice}
          refused={refused("registered_office")}
          maxLength={400}
          lines={3}
        />
        <Box label={copy.cin} value={cin} onValue={setCin} refused={refused("cin")} maxLength={21} capitals />
        <Box label={copy.gstin} value={gstin} onValue={setGstin} refused={refused("gstin")} maxLength={15} capitals />
        <Box
          label={copy.deliverTo}
          hint={copy.deliverHint}
          value={deliverTo}
          onValue={setDeliverTo}
          refused={refused("deliver_to")}
          maxLength={400}
          lines={4}
        />
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
