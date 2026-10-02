// Where the consultation is: the full address, asked in the form that books it, so nothing is booked without one
// (docs/decisions/0081-the-site-takes-the-address.md). No board draws it. Its fields and the ones it cannot do
// without are the client app's; the pincode is the one the page checked, shown and not asked again. A field left
// out says so beneath it, as the name and the number do. The floor, the tower and the landmark are folded away
// until asked for, beneath the flat.

import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { referral } from "../../content/referral.ts";
import { isRequiredPart, type AddressFields, type RequiredPart } from "../../lib/address.ts";
import styles from "./Invite.module.css";

type Part = keyof AddressFields;

/** The parts in the order the app asks for them, each with the API's longest and what a browser may fill it from. */
const FIELDS: readonly { part: Part; maxLength: number; autocomplete?: string; folded?: boolean }[] = [
  { part: "flat", maxLength: 40 },
  { part: "floor", maxLength: 20, folded: true },
  { part: "tower", maxLength: 40, folded: true },
  { part: "line1", maxLength: 120, autocomplete: "address-line1" },
  { part: "line2", maxLength: 120, autocomplete: "address-line2" },
  { part: "landmark", maxLength: 120, folded: true },
  { part: "locality", maxLength: 80, autocomplete: "address-level3" },
  { part: "city", maxLength: 40, autocomplete: "address-level2" },
];

const hasFoldedPart = (address: AddressFields): boolean =>
  FIELDS.some((field) => field.folded === true && address[field.part].trim() !== "");

const ACCESS_NOTES_MAX = 300;

function AddressField(props: {
  id: string;
  label: string;
  value: string;
  maxLength: number;
  autocomplete?: string | undefined;
  required: boolean;
  error: string | null;
  /** A line beneath the field that says what it is for. */
  hintId?: string;
  onInput: (value: string) => void;
}) {
  const bad = props.error !== null;
  const errorId = `${props.id}-error`;
  return (
    <div>
      <label class={styles.label} for={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        class={`${styles.input} ${bad ? styles.bad : ""}`}
        value={props.value}
        maxLength={props.maxLength}
        autocomplete={props.autocomplete}
        aria-required={props.required ? "true" : undefined}
        aria-invalid={bad}
        aria-describedby={bad ? errorId : props.hintId}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
        }}
      />
      <div aria-live="polite">
        {bad && (
          <div id={errorId} class={styles.error}>
            {props.error}
          </div>
        )}
      </div>
    </div>
  );
}

export function AddressFieldset(props: {
  address: AddressFields;
  /** The required parts to mark as left out: none until the form has been sent once. */
  missing: readonly RequiredPart[];
  pincode: string;
  idPrefix: string;
  onChange: (address: AddressFields) => void;
}) {
  const copy = referral.address;
  const { address, idPrefix } = props;
  const [unfolded, setUnfolded] = useState(() => hasFoldedPart(address));
  // Set as the folded fields are asked for, so focus moves to the first of them once they are drawn.
  const focusFolded = useRef(false);
  const idOf = (part: Part) => `${idPrefix}-address-${part}`;
  const shown = FIELDS.filter((field) => unfolded || field.folded !== true);

  useEffect(() => {
    if (!focusFolded.current) return;
    focusFolded.current = false;
    document.getElementById(idOf("floor"))?.focus();
  }, [unfolded]);

  const change = (part: Part) => (value: string) => {
    props.onChange({ ...address, [part]: value });
  };
  const hintId = `${idPrefix}-address-access-hint`;
  return (
    <fieldset class={styles.group}>
      <legend class={`caps ${styles.legend}`}>{copy.legend}</legend>
      <div class={styles.fields}>
        {shown.map(({ part, maxLength, autocomplete }) => (
          <Fragment key={part}>
            <AddressField
              id={idOf(part)}
              label={copy.labels[part]}
              value={address[part]}
              maxLength={maxLength}
              autocomplete={autocomplete}
              required={isRequiredPart(part)}
              error={isRequiredPart(part) && props.missing.includes(part) ? copy.errors[part] : null}
              onInput={change(part)}
            />
            {part === "flat" && !unfolded && (
              <button
                type="button"
                class={styles.more}
                onClick={() => {
                  focusFolded.current = true;
                  setUnfolded(true);
                }}
              >
                {copy.more}
              </button>
            )}
          </Fragment>
        ))}
        <div>
          <div class={styles.label}>{copy.pincode}</div>
          <p class={styles.addressPincode}>{props.pincode}</p>
        </div>
        <div>
          <AddressField
            id={`${idPrefix}-address-access-notes`}
            label={copy.labels.accessNotes}
            value={address.accessNotes}
            maxLength={ACCESS_NOTES_MAX}
            required={false}
            error={null}
            hintId={hintId}
            onInput={change("accessNotes")}
          />
          <p id={hintId} class={styles.hint}>
            {copy.accessHint}
          </p>
        </div>
      </div>
    </fieldset>
  );
}
