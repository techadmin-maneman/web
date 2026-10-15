// The building search on the address form (docs/decisions/0054-address-capture.md): the shared search
// (@maneman/ui/AddressSearch) in the client app's words and on its form's look. It follows
// the account section's number field, as the rest of the address form does.
//
// The session token is made once when the form opens and sent with every keystroke and again with the address, so
// Google bills one session. The API refuses a request without one.

import { AddressSearch } from "@maneman/ui/AddressSearch";
import { areaOfSuggestion } from "@maneman/web-kit/address";
import { api } from "../api.ts";
import { profile } from "../content.ts";
import styles from "./building-search.module.css";

interface ChosenBuilding {
  readonly placeId: string;
  readonly building: string;
  /** The area the suggestion names, for a form whose area is still empty. */
  readonly area: string | null;
}

export function BuildingSearch({
  value,
  sessionToken,
  pincode,
  onChoose,
  onClear,
}: {
  /** The building name in the draft, whether chosen or typed over. */
  readonly value: string;
  readonly sessionToken: string;
  /** The pincode in the draft, whose city keeps the search near it once it is whole. */
  readonly pincode: string;
  readonly onChoose: (chosen: ChosenBuilding) => void;
  /** Typing after a choice abandons it: the address is then whatever was typed. */
  readonly onClear: () => void;
}) {
  const copy = profile.form.building;
  return (
    <AddressSearch
      value={value}
      search={async (query) => {
        const answer = await api.addressSuggestions(query, sessionToken, pincode);
        return answer.ok ? { ok: true, suggestions: answer.body.suggestions } : { ok: false };
      }}
      onType={(typed) => {
        onClear();
        onChoose({ placeId: "", building: typed, area: null });
      }}
      onChoose={(chosen) => {
        onChoose({
          placeId: chosen.place_id,
          building: chosen.primary,
          area: areaOfSuggestion(chosen.primary, chosen.secondary),
        });
      }}
      words={{
        label: copy.label,
        hint: copy.hint,
        unavailable: copy.unavailable,
        attribution: copy.attribution,
        found: copy.found,
      }}
      className={styles.searchField}
    />
  );
}
