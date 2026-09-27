// "Where we come" (board G1): the address and its access notes, and the form to
// change them (AddressForm.tsx), which the booking sheet asks with too.

import { useRef, useState } from "react";
import type { Address } from "../api.ts";
import { profile } from "../content.ts";
import { focusIfLost } from "../lib/arrival.ts";
import { AddressForm, given } from "./AddressForm.tsx";
import styles from "./profile.module.css";

/**
 * The address on one line, narrowest part first, as an envelope is written. An
 * address saved before the flat and building fields existed holds nulls in all
 * of them and reads exactly as it did.
 */
function written(address: Address): string {
  const parts = [address.flat, address.floor, address.tower, address.building, address.line1, address.line2];
  return [...new Set(parts.filter(given))].concat(address.locality).join(", ");
}

export function AddressSection({ address, onSaved }: { address: Address | null; onSaved: () => void }) {
  const copy = profile;
  const heading = useRef<HTMLHeadingElement>(null);
  const [editing, setEditing] = useState(false);

  /** The form closes on the section's own heading, so the client lands where they were, not mid-page. */
  function closeForm() {
    setEditing(false);
    requestAnimationFrame(() => {
      heading.current?.scrollIntoView({ block: "start" });
      focusIfLost(heading.current);
    });
  }

  return (
    <section aria-labelledby="where">
      <h2 className={styles.label} id="where" ref={heading}>
        {copy.where}
      </h2>
      {editing ? (
        <AddressForm
          address={address}
          saveLabel={copy.form.save}
          onSaved={() => {
            closeForm();
            onSaved();
          }}
          onCancel={closeForm}
        />
      ) : (
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
          <button
            className={styles.link}
            type="button"
            onClick={() => {
              setEditing(true);
            }}
          >
            <span>{address === null ? copy.addAddress : copy.editAddress}</span>
          </button>
        </div>
      )}
    </section>
  );
}
