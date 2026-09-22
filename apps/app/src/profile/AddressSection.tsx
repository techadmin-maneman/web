// "Where we come" (board G1): the address and its access notes, and a form to
// change them. The design draws no form; its fields follow G2's number field.

import { useState } from "react";
import { api, type Address } from "../api.ts";
import { profile } from "../content.ts";
import styles from "./profile.module.css";

const EMPTY: Address = { line1: "", line2: null, locality: "", city: "", pincode: "", access_notes: null };

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

  async function save(draft: Address) {
    if (!complete(draft)) {
      setProblem(copy.form.invalid);
      return;
    }
    const answer = await api.saveAddress({
      ...draft,
      line2: draft.line2?.trim() === "" ? null : draft.line2,
      access_notes: draft.access_notes?.trim() === "" ? null : draft.access_notes,
    });
    if (answer.ok) {
      setEditing(null);
      setProblem(null);
      onSaved();
    } else {
      setProblem(copy.change.failed);
    }
  }

  const field = (key: keyof Address, label: string, options: { inputMode?: "numeric"; autoComplete?: string } = {}) => (
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
                {[address.line1, address.line2, address.locality].filter((part) => part !== null).join(", ")},{" "}
                {address.city} {address.pincode}
              </p>
              {address.access_notes !== null && <p className={styles.muted}>{address.access_notes}</p>}
            </>
          )}
          <button
            className={styles.link}
            type="button"
            onClick={() => {
              setEditing(address ?? EMPTY);
            }}
          >
            <span>{address === null ? copy.addAddress : copy.editAddress}</span>
          </button>
        </div>
      ) : (
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save(editing);
          }}
        >
          {field("line1", copy.form.line1, { autoComplete: "address-line1" })}
          {field("line2", copy.form.line2, { autoComplete: "address-line2" })}
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
            <button className={styles.primary} type="submit">
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
