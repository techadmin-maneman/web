// What Activity's log is narrowed to: who, what and the days, applied when Show is pressed. A client or a visit is
// narrowed to from a link to it (../route.ts, activityPath), and shown above the form as a filter to take off.

import { Button } from "@maneman/ui/Button";
import { DateInput, Field, Select, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { activity } from "../content/activity.ts";
import styles from "./activity.module.css";
import { ACTIONS, ACTOR_KINDS, type Filters } from "./filters.ts";

const copy = activity.filters;

interface Box {
  readonly label: string;
  readonly hint?: string;
  readonly value: string | undefined;
  readonly onChange: (value: string) => void;
}

function TextBox({ label, hint, value, onChange }: Box) {
  return (
    <Field label={label} hint={hint}>
      {(control) => (
        <TextInput
          {...control}
          value={value ?? ""}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

function DateBox({ label, value, onChange }: Box) {
  return (
    <Field label={label}>
      {(control) => (
        <DateInput
          {...control}
          value={value ?? ""}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** One of a list, or any: whose kind of entry, or which action. */
function Choice({ label, value, onChange, any, options }: Box & { any: string; options: readonly [string, string][] }) {
  return (
    <Field label={label}>
      {(control) => (
        <Select
          {...control}
          value={value ?? ""}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">{any}</option>
          {options.map(([option, said]) => (
            <option key={option} value={option}>
              {said}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

const KIND_OPTIONS = ACTOR_KINDS.map((kind): [string, string] => [kind, copy.kinds[kind]]);
const ACTION_OPTIONS = ACTIONS.map((action): [string, string] => [action, activity.actions[action]]);

export function Narrow({ filters, onApply }: { filters: Filters; onApply: (filters: Filters) => void }) {
  const [draft, setDraft] = useState(filters);
  const box = (name: keyof Filters) => ({
    value: draft[name]?.toString(),
    onChange: (value: string) => {
      setDraft({ ...draft, [name]: value === "" ? undefined : value });
    },
  });
  return (
    <form
      className={styles.filters}
      aria-label={copy.label}
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft);
      }}
    >
      <Choice label={copy.kind} any={copy.kinds.any} options={KIND_OPTIONS} {...box("actor_kind")} />
      <TextBox label={copy.actor} {...box("actor")} />
      <Choice label={copy.action} any={copy.anyAction} options={ACTION_OPTIONS} {...box("action")} />
      <DateBox label={copy.from} {...box("from")} />
      <DateBox label={copy.to} {...box("to")} />
      <div className={styles.apply}>
        <Button variant="primary" size="small" type="submit">
          {copy.show}
        </Button>
        <Button
          variant="outline"
          size="small"
          onClick={() => {
            setDraft({});
            onApply({ person: filters.person, visit: filters.visit });
          }}
        >
          {copy.clear}
        </Button>
      </div>
    </form>
  );
}
