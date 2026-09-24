// "Where we come" (board G1): the address and its access notes, and a form to
// change them. The design draws no form; its fields follow G2's number field.

import { useState } from "react";
import { api, type Address } from "../api.ts";
import { profile } from "../content.ts";
import { useOneAtATime } from "../lib/useOneAtATime.ts";
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

/** A part the client filled in. Absent and null mean the same: they did not. */
const given = (part: string | null | undefined): part is string =>
  part !== null && part !== undefined && part.trim() !== "";

/**
 * The address on one line, narrowest part first, as an envelope is written. An
 * address saved before the flat and building fields existed holds nulls in all
 * of them and reads exactly as it did.
 */
function written(address: Address): string {
  const parts = [address.flat, address.floor, address.tower, address.building, address.line1, address.line2];
  return [...new Set(parts.filter(given))].concat(address.locality).join(", ");
}

/**
 * The house and the area are still what make an address an address. The
 * building search is an addition, never a gate: a client who cannot use it, or
 * whose provider is down, fills these in and saves the same address.
 *
 * `line1` is the building where one was chosen, so a client who used the search
 * is never asked for the same words twice.
 */
function complete(address: Address): boolean {
  return (
    address.line1.trim() !== "" &&
    address.locality.trim() !== "" &&
    address.city.trim() !== "" &&
    /^\d{6}$/.test(address.pincode.trim())
  );
}

export function AddressSection({ address, onSaved }: { address: Address | null; onSaved: () => void }) {
  const copy = profile;
  const [editing, setEditing] = useState<Address | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // One token for the whole search, made when the form opens: it is what puts
  // Google's autocomplete on the free per-session price rather than per
  // keystroke (docs/decisions/0054-address-capture.md).
  const [sessionToken, setSessionToken] = useState("");
  // One save per intent: a second sends the same session token again, and Google bills a second
  // Place Details resolution against a session that was meant to close once (ADR 0054).
  const [busy, once] = useOneAtATime();

  const save = (chosenDraft: Address) =>
    once(async () => {
      // A building chosen from the search is the address's first line, so the
      // "House, flat or building" field is not shown and not asked for twice.
      const draft: Address = given(chosenDraft.building)
        ? { ...chosenDraft, line1: chosenDraft.building }
        : chosenDraft;
      if (!complete(draft)) {
        setProblem(copy.form.invalid);
        return;
      }
      const answer = await api.saveAddress({
        ...draft,
        line2: draft.line2?.trim() === "" ? null : draft.line2,
        access_notes: draft.access_notes?.trim() === "" ? null : draft.access_notes,
        session_token: sessionToken,
      });
      if (answer.ok) {
        setEditing(null);
        setProblem(null);
        onSaved();
      } else {
        setProblem(copy.change.failed);
      }
    });

  function edit() {
    setEditing(address ?? EMPTY);
    setSessionToken(crypto.randomUUID());
  }

  const field = (
    key: Exclude<keyof Address, "place_id">,
    label: string,
    options: { inputMode?: "numeric"; autoComplete?: string } = {},
  ) => (
    <label className={styles.formField}>
      <span className={styles.formLabel}>{label}</span>
      <input
        className={styles.input}
        value={editing?.[key] ?? ""}
        inputMode={options.inputMode}
        autoComplete={options.autoComplete}
        onChange={(event) => {
          setEditing((draft) => ({ ...(draft ?? EMPTY), [key]: event.target.value }));
        }}
      />
    </label>
  );

  return (
    <section aria-labelledby="where">
      <h2 className={styles.label} id="where">
        {copy.where}
      </h2>
      {editing === null ? (
        <div className={styles.block}>
          {address === null ? (
            <p className={styles.muted}>{copy.noAddress}</p>
          ) : (
            <>
              <p className={styles.address}>
                {written(address)}, {address.city} {address.pincode}
              </p>
              {given(address.landmark) && <p className={styles.muted}>{copy.near(address.landmark)}</p>}
              {address.access_notes !== null && <p className={styles.muted}>{address.access_notes}</p>}
            </>
          )}
          <button className={styles.link} type="button" onClick={edit}>
            <span>{address === null ? copy.addAddress : copy.editAddress}</span>
          </button>
        </div>
      ) : (
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
                ...(draft ?? EMPTY),
                building: building === "" ? null : building,
                // An empty ID means the client typed over the choice: the
                // building stands as words, and the address saves without a pin.
                place_id: placeId === "" ? null : placeId,
              }));
            }}
            onClear={() => {
              setEditing((draft) => (draft === null ? draft : { ...draft, place_id: null }));
            }}
          />
          {field("flat", copy.form.flat)}
          {field("floor", copy.form.floor)}
          {field("tower", copy.form.tower)}
          {/* Only for an address nobody searched for: otherwise the building is line one. */}
          {(editing.building ?? "").trim() === "" && field("line1", copy.form.line1, { autoComplete: "address-line1" })}
          {field("line2", copy.form.line2, { autoComplete: "address-line2" })}
          {field("landmark", copy.form.landmark)}
          {field("locality", copy.form.locality, { autoComplete: "address-level3" })}
          {field("city", copy.form.city, { autoComplete: "address-level2" })}
          {field("pincode", copy.form.pincode, { inputMode: "numeric", autoComplete: "postal-code" })}
          {field("access_notes", copy.form.accessNotes)}
          <p className={styles.muted}>{copy.form.accessHint}</p>
          {problem !== null && (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          )}
          <div className={styles.row}>
            <button className={styles.primary} type="submit" disabled={busy}>
              {copy.form.save}
            </button>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => {
                setEditing(null);
                setProblem(null);
              }}
            >
              {copy.form.cancel}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
