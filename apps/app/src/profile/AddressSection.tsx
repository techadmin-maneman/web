// "Where we come" (board G1): the address and its access notes, and the form to
// change them (AddressForm.tsx), which the booking sheet asks with too. An
// address the client gave ops on the phone says so, so the client can check what
// was typed for them (docs/decisions/0092-task-owners.md).

import { capsLook } from "@maneman/ui/Caps";
import { longDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import { addressLine, given } from "@maneman/web-kit/address";
import type { Address } from "../api.ts";
import { profile } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import { AddressForm } from "./AddressForm.tsx";
import styles from "./profile.module.css";

export function AddressSection({
  address,
  givenToOps,
  onSaved,
}: {
  address: Address | null;
  /** When the client gave the address to ops on the phone; null for one they saved themselves. */
  givenToOps: string | null;
  onSaved: () => void;
}) {
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
      <h2 className={capsLook(styles.label)} id="where" ref={heading}>
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
              <p className={styles.address}>{addressLine(address)}</p>
              {given(address.landmark) && (
                <dl className={styles.landmark}>
                  <dt className={styles.formLabel}>{copy.landmark}</dt>
                  <dd>{address.landmark}</dd>
                </dl>
              )}
              {address.access_notes !== null && <p className={styles.muted}>{address.access_notes}</p>}
              {givenToOps !== null && <p className={styles.muted}>{copy.givenToOps(longDate(givenToOps))}</p>}
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
