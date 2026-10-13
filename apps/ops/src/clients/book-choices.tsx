// The lists Book a visit chooses from (./BookVisit.tsx): each labelled choice, and what the visit may make good, free
// (docs/decisions/0192-free-remakes.md).

import { Field, Select } from "@maneman/ui/Field";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import type { VisitAvailability } from "../api.ts";
import { clients } from "../content.ts";
import styles from "../components/visit-dialog.module.css";

const copy = clients.visits.book;

type Owed = VisitAvailability["owed"][number];

const owedLabel = (owed: Owed): string => {
  const since = shortDate(indiaDate(owed.since));
  if (owed.why === "partial") return copy.owed.partial(since);
  return owed.why === "recall" ? copy.owed.recall(owed.piece_code) : copy.owed.failed(owed.piece_code, since);
};

/** What the visit may make good, free: shown only where something is owed. */
export function CoverChoice(props: {
  owed: readonly Owed[];
  value: string;
  busy: boolean;
  onChoose: (id: string) => void;
}) {
  if (props.owed.length === 0) return null;
  const options = [
    { value: "", label: copy.chargeAsUsual },
    ...props.owed.map((each) => ({ value: each.id, label: owedLabel(each) })),
  ];
  return (
    <Choose label={copy.covers} value={props.value} options={options} busy={props.busy} onChoose={props.onChoose} />
  );
}

/** A labelled list to choose from, as each of the form's choices is. */
export function Choose(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly busy: boolean;
  readonly onChoose: (value: string) => void;
}) {
  return (
    <Field className={styles.field} label={props.label}>
      {(control) => (
        <Select
          {...control}
          className={styles.select}
          value={props.value}
          disabled={props.busy}
          onChange={(event) => {
            props.onChoose(event.currentTarget.value);
          }}
        >
          {props.options.map((each) => (
            <option key={each.value} value={each.value}>
              {each.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
