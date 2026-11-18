// A technician's training: the day it is expected to end, given when they are added or on their details, and cleared
// once ops mark it done. In training, they take no visit of any kind
// (docs/decisions/0278-a-technician-in-training-takes-no-visits.md).

import { EditableRow } from "@maneman/ui/EditableRow";
import { DateInput, Field } from "@maneman/ui/Field";
import { shortDate } from "@maneman/web-kit/dates";
import { technicians } from "../content.ts";
import { EDITING } from "../content/common.ts";
import styles from "./technicians.module.css";

const copy = technicians.training;

/** The day a new technician's training is expected to end; left blank, they are not in training. */
export function TrainingField({ value, onChange }: { value: string; onChange: (day: string) => void }) {
  return (
    <Field label={copy.until} className={styles.formField}>
      {(control) => (
        <DateInput
          {...control}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** Their training on their details: the day it is expected to end, changed, or cleared once it is done. */
export function TrainingRow({
  endsOn,
  mayChange,
  save,
}: {
  endsOn: string | null;
  mayChange: boolean;
  save: (endsOn: string | null) => Promise<string | null>;
}) {
  return (
    <EditableRow<string>
      label={copy.until}
      words={EDITING}
      mayChange={mayChange}
      value={endsOn === null ? copy.none : shortDate(endsOn)}
      start={() => endsOn ?? ""}
      save={(typed) => save(typed === "" ? null : typed)}
    >
      {(control, typed, type) => (
        <DateInput
          {...control}
          value={typed}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      )}
    </EditableRow>
  );
}
