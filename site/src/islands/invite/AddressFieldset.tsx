// Where the consultation is: the full address, asked in the form that books it, so nothing is booked without one
// (docs/decisions/0081-the-site-takes-the-address.md). Its fields are the ones every form asks
// for (@maneman/ui/AddressFields); the pincode is the one the page checked, shown and not asked again. A field left
// out says so beneath it, as the name and the number do. The floor, the tower and the landmark are folded away
// until asked for, beneath the flat.

import { Fieldset } from "@maneman/ui/Field";
import { AddressFields } from "@maneman/ui/AddressFields";
import { AddressSearch } from "@maneman/ui/AddressSearch";
import { areaOfSuggestion, given, type AddressPart } from "@maneman/web-kit/address";
import { useEffect, useRef, useState } from "preact/hooks";
import { referral } from "../../content/referral.ts";
import type { AddressFields as Address, RequiredPart } from "../../lib/address.ts";
import { suggestBuildings } from "../../lib/api.ts";
import { fill } from "../../lib/text.ts";
import styles from "./Invite.module.css";

const copy = referral.address;

const WORDS = {
  labels: { ...copy.labels, access_notes: copy.labels.accessNotes, pincode: copy.pincode },
  hints: { access_notes: copy.accessHint },
  more: copy.more,
};

const ERRORS: Partial<Record<AddressPart, string>> = copy.errors;

/** Where the form holds a part: the pincode is the page's, not the form's. */
const keyOf = (part: AddressPart): keyof Address | null => {
  if (part === "pincode") return null;
  return part === "access_notes" ? "accessNotes" : part;
};

const FOLDED: readonly (keyof Address)[] = ["floor", "tower", "landmark"];

export function AddressFieldset(props: {
  address: Address;
  /** The required parts to mark as wrong: none until the form has been sent once. */
  missing: readonly RequiredPart[];
  pincode: string;
  idPrefix: string;
  onChange: (address: Address) => void;
}) {
  const { address, idPrefix } = props;
  const [unfolded, setUnfolded] = useState(() => FOLDED.some((part) => address[part].trim() !== ""));
  // Set as the folded fields are asked for, so focus moves to the first of them once they are drawn.
  const focusFolded = useRef(false);

  useEffect(() => {
    if (!focusFolded.current) return;
    focusFolded.current = false;
    document.getElementById(`${idPrefix}-address-floor`)?.focus();
  }, [unfolded, idPrefix]);

  return (
    <Fieldset legend={copy.legend} legendLook="caps">
      <div class={styles.fields}>
        <AddressSearch
          value={address.building}
          search={async (query) => {
            const answer = await suggestBuildings(query, address.session, props.pincode);
            return answer.ok ? { ok: true, suggestions: answer.body.suggestions } : { ok: false };
          }}
          onType={(typed) => {
            // A building typed stands as words: the address books without a pin.
            props.onChange({ ...address, building: typed, placeId: "" });
          }}
          onChoose={(chosen) => {
            // The area the suggestion names, where the client has not typed one.
            const locality = given(address.locality)
              ? address.locality
              : (areaOfSuggestion(chosen.primary, chosen.secondary) ?? "");
            props.onChange({ ...address, building: chosen.primary, placeId: chosen.place_id, locality });
          }}
          words={{
            ...copy.building,
            found: (count) =>
              count === 1 ? copy.building.foundOne : fill(copy.building.foundMany, { count: String(count) }),
          }}
        />
        <AddressFields
          without={address.building.trim() === "" ? [] : ["line1"]}
          idPrefix={`${idPrefix}-address`}
          valueOf={(part) => {
            const key = keyOf(part);
            return key === null ? "" : address[key];
          }}
          shownPincode={props.pincode}
          folded={
            unfolded
              ? undefined
              : {
                  onUnfold: () => {
                    focusFolded.current = true;
                    setUnfolded(true);
                  },
                }
          }
          marked={props.missing}
          errorOf={(part) => ERRORS[part] ?? ""}
          onChange={(part, value) => {
            const key = keyOf(part);
            if (key !== null) props.onChange({ ...address, [key]: value });
          }}
          words={WORDS}
        />
      </div>
    </Fieldset>
  );
}
