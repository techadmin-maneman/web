// What a printed purchase order says of us (docs/decisions/0166-purchase-orders.md): the legal name, the registered
// office and CIN, the GSTIN and where the supplier delivers, which a manager sets once and each printed order carries.
// Once set, each line changes where it reads (docs/decisions/0212-editing-in-place.md), the rest sent as they stand.

import { Panel } from "@maneman/ui/Panel";
import { Field, TextArea, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { EDITING } from "../content/common.ts";
import { purchasing } from "../content/purchasing.ts";
import { AddForm } from "../components/AddForm.tsx";
import { LinesRow, TextRow } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import type { Orders } from "./types.ts";
import { purchasingApi } from "./purchasing-api.ts";

const copy = purchasing.letterhead;

/** One of the letterhead's boxes: a line, in capitals for a number, or an address of a few lines. */
function LetterheadEntry(props: {
  readonly label: string;
  readonly hint?: string;
  readonly box: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly maxLength: number;
  readonly lines?: number;
  readonly capitals?: boolean;
}) {
  const given = (value: string) => {
    props.onValue(props.capitals === true ? value.toUpperCase() : value);
  };
  return (
    <Field label={props.label} hint={props.hint} box={props.box} className={form.field}>
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

type Letter = NonNullable<Orders["letterhead"]>;

/** The letterhead's first setting, every line at once. */
function SetLetterhead({ onSaved }: { onSaved: (next: Orders, said: string) => void }) {
  const [draft, setDraft] = useState<Draft>({
    legal_name: "",
    registered_office: "",
    cin: "",
    gstin: "",
    deliver_to: "",
  });
  return (
    <AddForm
      title={copy.title}
      words={{ add: copy.save, cancel: EDITING.cancel }}
      errors={copy.errors}
      boxes={ENTRIES.map((entry) => entry.field)}
      send={() =>
        purchasingApi.setLetterhead({
          legal_name: draft.legal_name,
          registered_office: given(draft.registered_office),
          cin: given(draft.cin),
          gstin: given(draft.gstin),
          deliver_to: draft.deliver_to,
        })
      }
      onAdded={(next) => {
        onSaved(next, copy.saved);
      }}
      onCancel={null}
    >
      {ENTRIES.map(({ field, ...entry }) => (
        <LetterheadEntry
          key={field}
          {...entry}
          box={field}
          value={draft[field]}
          onValue={(value) => {
            setDraft({ ...draft, [field]: value });
          }}
        />
      ))}
    </AddForm>
  );
}

/** The letterhead as set: each line changed where it reads. */
function LetterheadRows({ letter, onSaved }: { letter: Letter; onSaved: (next: Orders, said: string) => void }) {
  const mayChange = useAccess().mayCall("POST /api/purchase-orders/letterhead");
  const save =
    (field: keyof Draft, capitals = false) =>
    async (typed: string) => {
      const text = capitals ? typed.toUpperCase() : typed;
      const answer = await purchasingApi.setLetterhead({
        ...letter,
        [field]: field === "legal_name" || field === "deliver_to" ? text : given(text),
      });
      if (!answer.ok) return errorText(copy.errors, answer);
      onSaved(answer.body, copy.saved);
      return null;
    };
  return (
    <div className={form.record}>
      {ENTRIES.map(({ field, label, maxLength, lines, capitals }) =>
        lines === undefined ? (
          <TextRow
            key={field}
            label={label}
            value={letter[field] ?? ""}
            shown={letter[field] ?? copy.none}
            maxLength={maxLength}
            mayChange={mayChange}
            save={save(field, capitals)}
          />
        ) : (
          <LinesRow
            key={field}
            label={label}
            value={letter[field] ?? ""}
            shown={letter[field] ?? copy.none}
            maxLength={maxLength}
            lines={lines}
            mayChange={mayChange}
            save={save(field)}
          />
        ),
      )}
    </div>
  );
}

export function Letterhead({ orders, onSaved }: { orders: Orders; onSaved: (next: Orders, said: string) => void }) {
  const letter = orders.letterhead;
  return (
    <Panel titleId="letterhead" title={copy.title}>
      {letter === null ? (
        <>
          <Note>{copy.missing}</Note>
          <SetLetterhead onSaved={onSaved} />
        </>
      ) : (
        <LetterheadRows letter={letter} onSaved={onSaved} />
      )}
    </Panel>
  );
}
