// A technician's start date: the day they started with us, given when they are added or on their details, and shown
// as "Started 3 Mar 2026" in their head (docs/decisions/0305-a-technicians-start-date.md).

import { EditableRow } from "@maneman/ui/EditableRow";
import { DateInput, Field } from "@maneman/ui/Field";
import { longDate } from "@maneman/web-kit/dates";
import { technicians } from "../content.ts";
import { EDITING } from "../content/common.ts";
import styles from "./technicians.module.css";

const copy = technicians.started;

/** The day a new technician started; left blank, it is not given. */
export function StartedField({ value, onChange }: { value: string; onChange: (day: string) => void }) {
  return (
    <Field label={copy.label} className={styles.formField}>
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

/** Their start date on their details: given, changed, or cleared. */
export function StartedRow({
  startedOn,
  mayChange,
  save,
}: {
  startedOn: string | null;
  mayChange: boolean;
  save: (startedOn: string | null) => Promise<string | null>;
}) {
  return (
    <EditableRow<string>
      label={copy.label}
      words={EDITING}
      mayChange={mayChange}
      value={startedOn === null ? copy.none : longDate(startedOn)}
      start={() => startedOn ?? ""}
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
