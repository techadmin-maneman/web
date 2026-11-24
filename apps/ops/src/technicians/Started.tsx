// A technician's start date: the day they started with us, given when they are added or on their details, and shown
// as "Started 3 Mar 2026" in their head (docs/decisions/0305-a-technicians-start-date.md).

import { EditableRow } from "@maneman/ui/EditableRow";
import { DateInput, Field } from "@maneman/ui/Field";
import { longDate } from "@maneman/web-kit/dates";
import { technicians } from "../content.ts";
import { EDITING } from "../content/common.ts";

const copy = technicians.started;

/** The day a new technician started; left blank, it is not given. */
export function StartedField({ value, onChange }: { value: string; onChange: (day: string) => void }) {
  return (
    <Field label={copy.optional}>
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
  startDate,
  mayChange,
  save,
}: {
  startDate: string | null;
  mayChange: boolean;
  save: (startDate: string | null) => Promise<string | null>;
}) {
  return (
    <EditableRow<string>
      label={copy.label}
      words={EDITING}
      mayChange={mayChange}
      value={startDate === null ? copy.none : longDate(startDate)}
      start={() => startDate ?? ""}
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
