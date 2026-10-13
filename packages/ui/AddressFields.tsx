// An address's parts as labelled fields, in the order every form asks for them, each held to the API's longest and
// marked required where an address cannot do without it (@maneman/web-kit/address). The client app's form
// and the site's /book and invite pages draw it, each in its own words and its own look; the building search, the
// save and what a refusal offers stay each form's own. The site compiles it with Preact (site/astro.config.ts), so it
// uses nothing Preact lacks: its fields listen with onInput, which React and Preact hear alike.

import { ADDRESS_FIELDS, type AddressField, type AddressPart } from "@maneman/web-kit/address";
import { Label, TextInput } from "./Field.tsx";
import { TextButton } from "./TextLink.tsx";
import styles from "./address-fields.module.css";

export interface AddressFieldsWords {
  readonly labels: Readonly<Record<AddressPart, string>>;
  /** A line beneath a part that says what it is for. */
  readonly hints?: Readonly<Partial<Record<AddressPart, string>>>;
  /** The button that unfolds the folded parts, where the form folds them. */
  readonly more?: string;
}

interface Props {
  /** Each part's id is the prefix and the part: "address-flat". */
  readonly idPrefix: string;
  readonly valueOf: (part: AddressPart) => string;
  /** Parts the form does not ask for, as line one where a building was chosen. */
  readonly without?: readonly AddressPart[];
  /** The pincode already checked, shown in its place rather than asked again. */
  readonly shownPincode?: string;
  /** The floor, the tower and the landmark folded away beneath the flat, and the way to unfold them. */
  readonly folded?: { readonly onUnfold: () => void } | undefined;
  readonly marked: readonly AddressPart[];
  /** A marked part's own line beneath it; without one, `describedBy` names the form's one line. */
  readonly errorOf?: (part: AddressPart) => string;
  readonly describedBy?: string;
  readonly disabled?: boolean;
  readonly onChange: (part: AddressPart, value: string) => void;
  readonly words: AddressFieldsWords;
  /** Each part's place in its form, where the form lays them out itself. */
  readonly fieldClassName?: string;
}

function PartInput({ field, props }: { field: AddressField; props: Props }) {
  const { part } = field;
  const id = `${props.idPrefix}-${part}`;
  const marked = props.marked.includes(part);
  const error = marked && props.errorOf !== undefined ? props.errorOf(part) : null;
  const hint = props.words.hints?.[part];
  let describedBy = hint === undefined ? undefined : `${id}-hint`;
  if (marked) describedBy = error === null ? props.describedBy : `${id}-error`;
  return (
    <div className={props.fieldClassName}>
      <Label htmlFor={id}>{props.words.labels[part]}</Label>
      <TextInput
        id={id}
        value={props.valueOf(part)}
        maxLength={field.maxLength}
        autoComplete={field.autoComplete}
        inputMode={field.inputMode}
        required={field.required}
        aria-required={field.required === true ? "true" : undefined}
        aria-invalid={marked ? true : undefined}
        aria-describedby={describedBy}
        disabled={props.disabled}
        onInput={(event) => {
          props.onChange(part, event.currentTarget.value);
        }}
      />
      {props.errorOf !== undefined && (
        <div aria-live="polite">
          {error !== null && (
            <p id={`${id}-error`} className={styles.error}>
              {error}
            </p>
          )}
        </div>
      )}
      {hint !== undefined && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function AddressFields(props: Props) {
  const { words } = props;
  const shown = ADDRESS_FIELDS.filter(
    ({ part, folded }) => props.without?.includes(part) !== true && (props.folded === undefined || folded !== true),
  );
  // One flat list, the unfolding button a sibling of the flat's field, so a grid spaces it as it spaces the fields.
  return (
    <>
      {shown.flatMap((field) => {
        if (field.part === "pincode" && props.shownPincode !== undefined) {
          return [
            <div key={field.part} className={props.fieldClassName}>
              <p className={styles.label}>{words.labels.pincode}</p>
              <p className={styles.shown}>{props.shownPincode}</p>
            </div>,
          ];
        }
        const input = <PartInput key={field.part} field={field} props={props} />;
        if (field.part !== "flat" || props.folded === undefined) return [input];
        return [
          input,
          <TextButton key="more" tone="muted" onClick={props.folded.onUnfold}>
            {words.more}
          </TextButton>,
        ];
      })}
    </>
  );
}
