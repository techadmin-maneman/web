// One pincode's drawer at Settings › Areas (./ServedParts.tsx): its area's name, whether we go there and from when,
// and, while we do not and nothing names it, the way to delete it (docs/decisions/0283-changed-and-deleted-while-unused.md).

import { CancelButton } from "@maneman/ui/CancelButton";
import { DeleteAction } from "@maneman/ui/DeleteAction";
import { Field, Checkbox, DateInput, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import type { ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import form from "@maneman/ui/forms.module.css";
import type { Row } from "./served-draft.ts";
import { areasApi } from "./areas-api.ts";
import { Refusal } from "@maneman/ui/Refusal";
import { FormActions } from "@maneman/ui/FormActions";
import { FormDrawer } from "@maneman/ui/FormDrawer";

const copy = areas.served;

/** One pincode's three settings, a box each, in a drawer beside the table; Save sends them. */
export function PincodeDrawer({
  pincode,
  row,
  onSave,
  onDeleted,
  onClose,
}: {
  pincode: ServedPincode;
  row: Row;
  onSave: (next: Row) => string | null;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const id = pincode.pincode;
  const mayDelete = useAccess().mayCall("POST /api/pincodes/{pin}/delete");
  const [next, setNext] = useState(row);
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <FormDrawer title={copy.editTitle(id, row.area)} onClose={onClose}>
      <div className={form.fields}>
        <Field label={copy.columns[1]}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={40}
              value={next.area}
              onChange={(event) => {
                setNext({ ...next, area: event.target.value });
              }}
            />
          )}
        </Field>
        <Checkbox
          label={copy.columns[2]}
          checked={next.served}
          onChange={(event) => {
            setNext({ ...next, served: event.target.checked });
          }}
        />
        <Field label={copy.columns[3]}>
          {(control) => (
            <DateInput
              {...control}
              width="date"
              value={next.launch_on ?? ""}
              onChange={(event) => {
                setNext({ ...next, launch_on: event.target.value === "" ? null : event.target.value });
              }}
            />
          )}
        </Field>
      </div>
      {refused !== null && <Refusal className={form.error} said={refused} />}
      <FormActions>
        <Button
          variant="primary"
          size="small"
          onClick={() => {
            setRefused(onSave(next));
          }}
        >
          {copy.save}
        </Button>
        <CancelButton onClick={onClose} />
      </FormActions>
      {pincode.deletable && !pincode.served && mayDelete && (
        <div className={form.recordFoot}>
          <DeleteAction
            name={id}
            send={() => areasApi.deletePincode(id)}
            refusal={(code) => errorText(copy.deleteErrors, { code })}
            onDeleted={onDeleted}
          />
        </div>
      )}
    </FormDrawer>
  );
}
