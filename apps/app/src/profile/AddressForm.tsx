// The address form, with the building search (docs/decisions/0054-address-capture.md): Profile's "Where we come"
// (board G1) opens it, and the booking sheet asks for it before any slot when the client has given none
// (docs/decisions/0079-an-address-before-a-slot.md). The design draws no form; its fields follow G2's number
// field. The fields an address cannot do without say they are required, and one left out is marked, named by the
// error, and given the focus.

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, type Address } from "../api.ts";
import { profile } from "../content.ts";
import { BuildingSearch } from "./BuildingSearch.tsx";
import styles from "./profile.module.css";

const EMPTY: Address = {
  line1: "",
  line2: null,
  locality: "",
  city: "",
  pincode: "",
  access_notes: null,
  building: null,
  flat: null,
  floor: null,
  tower: null,
  landmark: null,
  place_id: null,
};

type Field = Exclude<keyof Address, "place_id">;

const ERROR_ID = "address-error";

/** A part the client filled in. Absent and null mean the same: they did not. */
export const given = (part: string | null | undefined): part is string =>
  part !== null && part !== undefined && part.trim() !== "";

/**
 * The fields an address is not one without, left out. The building search is
 * an addition, never a gate: a client who cannot use it, or whose provider is
 * down, fills these in and saves the same address. `line1` is the building
 * where one was chosen, so a client who used the search is never asked for the
 * same words twice.
 */
function missing(address: Address): Field[] {
  const left: Field[] = [];
  if (address.line1.trim() === "") left.push("line1");
  if (address.locality.trim() === "") left.push("locality");
  if (address.city.trim() === "") left.push("city");
  if (!/^\d{6}$/.test(address.pincode.trim())) left.push("pincode");
  return left;
}

export function AddressForm({
  address,
  saveLabel,
  onSaved,
  onCancel,
}: {
  /** The address to change; null for a client who has given none. */
  address: Address | null;
  saveLabel: string;
  onSaved: () => void;
  /** Profile's way back to the address as it was; the booking sheet has its own Close. */
  onCancel?: () => void;
}) {
  const copy = profile;
  const [editing, setEditing] = useState<Address>(address ?? EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<readonly Field[]>([]);
  // One token for the whole search, made when the form opens: it is what puts
  // Google's autocomplete on the free per-session price rather than per
  // keystroke (docs/decisions/0054-address-capture.md).
  const [sessionToken] = useState(() => crypto.randomUUID());
  // One save per intent: a second sends the same session token again, and Google bills a second
  // Place Details resolution against a session that was meant to close once (ADR 0054).
  const [busy, once] = useOneAtATime();

  const save = (chosenDraft: Address) =>
    once(async () => {
      // A building chosen from the search is the address's first line, so the
      // "Building, society or street" field is not shown and not asked for twice.
      const draft: Address = given(chosenDraft.building)
        ? { ...chosenDraft, line1: chosenDraft.building }
        : chosenDraft;
      const left = missing(draft);
      setInvalid(left);
      if (left.length > 0) {
        setProblem(copy.form.invalid);
        document.getElementById(`address-${left[0] ?? ""}`)?.focus();
        return;
      }
      const answer = await api.saveAddress({
        ...draft,
        line2: draft.line2?.trim() === "" ? null : draft.line2,
        access_notes: draft.access_notes?.trim() === "" ? null : draft.access_notes,
        session_token: sessionToken,
      });
      if (!answer.ok) {
        setProblem(copy.change.failed);
        return;
      }
      onSaved();
    });

  const field = (
    key: Field,
    label: string,
    options: { inputMode?: "numeric"; autoComplete?: string; required?: boolean } = {},
  ) => {
    const wrong = invalid.includes(key);
    return (
      <label className={styles.formField}>
        <span className={styles.formLabel}>{label}</span>
        <input
          id={`address-${key}`}
          className={styles.input}
          value={editing[key] ?? ""}
          inputMode={options.inputMode}
          autoComplete={options.autoComplete}
          required={options.required}
          aria-invalid={wrong ? true : undefined}
          aria-describedby={wrong ? ERROR_ID : undefined}
          onChange={(event) => {
            setEditing((draft) => ({ ...draft, [key]: event.target.value }));
          }}
        />
      </label>
    );
  };

  return (
    <form
      className={styles.form}
      noValidate
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void save(editing);
      }}
    >
      <BuildingSearch
        value={editing.building ?? ""}
        sessionToken={sessionToken}
        onChoose={({ placeId, building }) => {
          setEditing((draft) => ({
            ...draft,
            building: building === "" ? null : building,
            // An empty ID means the client typed over the choice: the
            // building stands as words, and the address saves without a pin.
            place_id: placeId === "" ? null : placeId,
          }));
        }}
        onClear={() => {
          setEditing((draft) => ({ ...draft, place_id: null }));
        }}
      />
      {field("flat", copy.form.flat)}
      {field("floor", copy.form.floor)}
      {field("tower", copy.form.tower)}
      {/* Only for an address nobody searched for: otherwise the building is line one. */}
      {(editing.building ?? "").trim() === "" &&
        field("line1", copy.form.line1, { autoComplete: "address-line1", required: true })}
      {field("line2", copy.form.line2, { autoComplete: "address-line2" })}
      {field("landmark", copy.form.landmark)}
      {field("locality", copy.form.locality, { autoComplete: "address-level3", required: true })}
      {field("city", copy.form.city, { autoComplete: "address-level2", required: true })}
      {field("pincode", copy.form.pincode, { inputMode: "numeric", autoComplete: "postal-code", required: true })}
      {field("access_notes", copy.form.accessNotes)}
      <p className={styles.muted}>{copy.form.accessHint}</p>
      {problem !== null && (
        <p className={styles.error} id={ERROR_ID} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.row}>
        <Button variant="primary" size="control" className={styles.primary} type="submit" disabled={busy}>
          {saveLabel}
        </Button>
        {onCancel !== undefined && (
          <Button variant="outline" size="control" className={styles.secondary} onClick={onCancel}>
            {copy.form.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
