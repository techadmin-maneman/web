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
function LetterheadEntry(props: {
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

/** What ops type in each box, by the name the API takes it by. */
type Draft = Record<"legal_name" | "registered_office" | "cin" | "gstin" | "deliver_to", string>;

/** The letterhead's boxes, in the order a printed order reads them. */
const ENTRIES: readonly {
  readonly field: keyof Draft;
  readonly label: string;
  readonly hint?: string;
  readonly maxLength: number;
  readonly lines?: number;
  readonly capitals?: boolean;
}[] = [
  { field: "legal_name", label: copy.legalName, maxLength: 120 },
  { field: "registered_office", label: copy.registeredOffice, maxLength: 400, lines: 3 },
  { field: "cin", label: copy.cin, maxLength: 21, capitals: true },
  { field: "gstin", label: copy.gstin, maxLength: 15, capitals: true },
  { field: "deliver_to", label: copy.deliverTo, hint: copy.deliverHint, maxLength: 400, lines: 4 },
];

/** A box left empty is sent as nothing to print. */
const given = (text: string) => (text.trim() === "" ? null : text);

export function Letterhead({ orders, onSaved }: { orders: Orders; onSaved: (next: Orders, said: string) => void }) {
  const set = orders.letterhead;
  const [draft, setDraft] = useState<Draft>({
    legal_name: set?.legal_name ?? "",
    registered_office: set?.registered_office ?? "",
    cin: set?.cin ?? "",
    gstin: set?.gstin ?? "",
    deliver_to: set?.deliver_to ?? "",
  });
  const write = useWrite<Orders>((next) => {
    onSaved(next, copy.saved);
  });
  const refused = (field: string) =>
    write.failure?.fields?.includes(field) === true ? errorText(copy.errors, write.failure) : null;

  return (
    <Panel titleId="letterhead" title={copy.title}>
      {set === null && <Note>{copy.missing}</Note>}
      <form
        className={form.group}
        onSubmit={(event) => {
          event.preventDefault();
          const body = {
            legal_name: draft.legal_name,
            registered_office: given(draft.registered_office),
            cin: given(draft.cin),
            gstin: given(draft.gstin),
            deliver_to: draft.deliver_to,
          };
          void write.send(() => purchasingApi.setLetterhead(body));
        }}
      >
        {ENTRIES.map(({ field, ...entry }) => (
          <LetterheadEntry
            key={field}
            {...entry}
            value={draft[field]}
            onValue={(value) => {
              setDraft({ ...draft, [field]: value });
            }}
            refused={refused(field)}
          />
        ))}
        {write.failure !== null && write.failure.fields === undefined && (
          <Refusal className={form.error} said={errorText(copy.errors, write.failure)} />
        )}
        <FormActions>
          <Button
            variant="primary"
            size="small"
            type="submit"
            disabled={write.busy || draft.legal_name.trim() === "" || draft.deliver_to.trim() === ""}
          >
            {copy.save}
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}
