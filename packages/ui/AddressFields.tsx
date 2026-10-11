// An address's parts as labelled fields, in the order every form asks for them, each held to the API's longest and
// marked required where an address cannot do without it (@maneman/web-kit/address). The client app's form
// and the site's /book and invite pages draw it, each in its own words and its own look; the building search, the
// save and what a refusal offers stay each form's own. The site compiles it with Preact (site/astro.config.ts), so it
// uses nothing Preact lacks: its fields listen with onInput, which React and Preact hear alike.

import { ADDRESS_FIELDS, type AddressField, type AddressPart } from "@maneman/web-kit/address";
import { classes as join } from "./classes.ts";

export interface AddressFieldsWords {
  readonly labels: Readonly<Record<AddressPart, string>>;
  /** A line beneath a part that says what it is for. */
  readonly hints?: Readonly<Partial<Record<AddressPart, string>>>;
  /** The button that unfolds the folded parts, where the form folds them. */
  readonly more?: string;
}

type ClassName = string | undefined;

/** Each surface's own look. */
export interface AddressFieldsClasses {
  readonly field: ClassName;
  readonly label: ClassName;
  readonly input: ClassName;
  /** Added to a marked part's input. */
  readonly inputBad?: ClassName;
  readonly error?: ClassName;
  readonly hint?: ClassName;
  readonly more?: ClassName;
  /** The pincode, where it is shown rather than asked. */
  readonly shown?: ClassName;
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
  readonly classes: AddressFieldsClasses;
}

function PartInput({ field, props }: { field: AddressField; props: Props }) {
  const { part } = field;
  const { classes } = props;
  const id = `${props.idPrefix}-${part}`;
  const marked = props.marked.includes(part);
  const error = marked && props.errorOf !== undefined ? props.errorOf(part) : null;
  const hint = props.words.hints?.[part];
  let describedBy = hint === undefined ? undefined : `${id}-hint`;
  if (marked) describedBy = error === null ? props.describedBy : `${id}-error`;
  return (
    <div className={classes.field}>
      <label className={classes.label} htmlFor={id}>
        {props.words.labels[part]}
      </label>
      <input
        id={id}
        className={join(classes.input, marked && classes.inputBad)}
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
            <div id={`${id}-error`} className={classes.error}>
              {error}
            </div>
          )}
        </div>
      )}
      {hint !== undefined && (
        <p id={`${id}-hint`} className={classes.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function AddressFields(props: Props) {
  const { classes, words } = props;
  const shown = ADDRESS_FIELDS.filter(
    ({ part, folded }) => props.without?.includes(part) !== true && (props.folded === undefined || folded !== true),
  );
  // One flat list, the unfolding button a sibling of the flat's field, so a grid spaces it as it spaces the fields.
  return (
    <>
      {shown.flatMap((field) => {
        if (field.part === "pincode" && props.shownPincode !== undefined) {
          return [
            <div key={field.part} className={classes.field}>
              <div className={classes.label}>{words.labels.pincode}</div>
              <p className={classes.shown}>{props.shownPincode}</p>
            </div>,
          ];
        }
        const input = <PartInput key={field.part} field={field} props={props} />;
        if (field.part !== "flat" || props.folded === undefined) return [input];
        return [
          input,
          <button key="more" type="button" className={classes.more} onClick={props.folded.onUnfold}>
            {words.more}
          </button>,
        ];
      })}
    </>
  );
}
