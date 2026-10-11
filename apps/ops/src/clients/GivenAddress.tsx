// An address a client gives ops on the phone, recorded on their page and saved
// as theirs, marked as given to ops (docs/decisions/0092-task-owners.md; open
// point 62). The form follows the client app's own (apps/app/src/profile/AddressForm.tsx):
// the same fields (@maneman/web-kit/address) and checks, and the same building search, whose one session
// token covers every keystroke and the save, so Google bills the search once
// (docs/decisions/0054-address-capture.md). The search is an addition, never a
// gate: an address typed without it saves, with no pin. No board draws any of it.

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { AddressSearch, type AddressSearchClasses, type AddressSuggestion } from "@maneman/ui/AddressSearch";
import { useId, useRef, useState } from "react";
import { ADDRESS_FIELDS, given, missingParts, type AddressField, type AddressPart } from "@maneman/web-kit/address";
import { api, type AddressGiven, type ClientRecord } from "../api.ts";
import { clients, NOT_PERMITTED } from "../content.ts";
import styles from "./address.module.css";

const copy = clients.visits.given;

type Draft = Omit<AddressGiven, "session_token">;

const LABELS: Readonly<Record<AddressPart, string>> = { ...copy, access_notes: copy.accessNotes };

const EMPTY: Draft = {
  line1: "",
  line2: null,
  locality: "",
  city: "",
  pincode: "",
  access_notes: null,
  building: null,
  flat: "",
  floor: null,
  tower: null,
  landmark: null,
  place_id: null,
};

/** A part left blank is none, as the API holds it. */
const orNull = (part: string | null | undefined): string | null => (given(part) ? part.trim() : null);

const SEARCH_CLASSES: AddressSearchClasses = {
  field: styles.search,
  label: styles.label,
  input: styles.input,
  suggestions: styles.suggestions,
  suggestion: styles.suggestion,
  suggestionActive: styles.suggestionActive,
  where: styles.where,
  hint: styles.hint,
  attribution: styles.hint,
};

/** The building search: the shared one (@maneman/ui/AddressSearch), in the console's words and on its form's look. */
function BuildingSearch({
  clientId,
  value,
  sessionToken,
  onType,
  onChoose,
}: {
  clientId: string;
  value: string;
  sessionToken: string;
  /** Typing after a choice abandons it: the building is then whatever was typed, with no pin. */
  onType: (building: string) => void;
  onChoose: (chosen: AddressSuggestion) => void;
}) {
  const searchCopy = copy.building;
  return (
    <AddressSearch
      value={value}
      search={async (query) => {
        const answer = await api.addressSuggestions(clientId, query, sessionToken);
        return answer.ok ? { ok: true, suggestions: answer.body.suggestions } : { ok: false };
      }}
      onType={onType}
      onChoose={onChoose}
      words={{
        label: searchCopy.label,
        hint: null,
        unavailable: searchCopy.unavailable,
        attribution: searchCopy.attribution,
        found: searchCopy.found,
      }}
      classes={SEARCH_CLASSES}
    />
  );
}

export function GivenAddressForm({
  clientId,
  onSaved,
  onCancel,
}: {
  clientId: string;
  onSaved: (address: NonNullable<ClientRecord["address"]>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [invalid, setInvalid] = useState<readonly AddressPart[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  // One token for the whole search, made when the form opens (docs/decisions/0054-address-capture.md).
  const [sessionToken] = useState(() => crypto.randomUUID());
  // One save per intent: a second would send the same session token again, and be billed again.
  const [busy, once] = useOneAtATime();
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);

  const save = () =>
    once(async () => {
      // A building chosen from the search is the address's first line, as the app's form makes it.
      const sent: Draft = given(draft.building) ? { ...draft, line1: draft.building } : draft;
      const left = missingParts(sent);
      setInvalid(left);
      if (left.length > 0) {
        setProblem(copy.invalid);
        // Once the fields are marked, the first one left out takes the keyboard.
        requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>("[aria-invalid]")?.focus());
        return;
      }
      const answer = await api.saveGivenAddress(clientId, {
        ...sent,
        line2: orNull(sent.line2),
        access_notes: orNull(sent.access_notes),
        flat: sent.flat.trim(),
        floor: orNull(sent.floor),
        tower: orNull(sent.tower),
        landmark: orNull(sent.landmark),
        session_token: sessionToken,
      });
      if (!answer.ok) {
        setProblem(answer.code === "not_permitted" ? NOT_PERMITTED : copy.failed);
        return;
      }
      onSaved(answer.body);
    });

  const field = ({ part, maxLength, required, inputMode }: AddressField) => (
    <Field key={part} label={LABELS[part]} error={invalid.includes(part) ? copy.invalid : null}>
      {(control) => (
        <TextInput
          {...control}
          className={styles.input}
          inputMode={inputMode}
          maxLength={maxLength}
          required={required}
          // A client's address, typed for them: never the browser's own saved one.
          autoComplete="off"
          value={draft[part] ?? ""}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            setDraft((was) => ({ ...was, [part]: value }));
          }}
        />
      )}
    </Field>
  );

  return (
    <form
      ref={form}
      className={styles.form}
      noValidate
      aria-busy={busy}
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3 className={capsLook(styles.title)} id={`${formId}-title`}>
        {copy.title}
      </h3>
      <BuildingSearch
        clientId={clientId}
        value={draft.building ?? ""}
        sessionToken={sessionToken}
        onType={(building) => {
          setDraft((was) => ({ ...was, building: building === "" ? null : building, place_id: null }));
        }}
        onChoose={(chosen) => {
          setDraft((was) => ({ ...was, building: chosen.primary, place_id: chosen.place_id }));
        }}
      />
      {/* A building chosen from the search is line one, so line one is asked only where none was. */}
      {ADDRESS_FIELDS.filter(({ part }) => part !== "line1" || !given(draft.building)).map(field)}
      {problem !== null && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="primary" size="small" type="submit" busy={busy}>
          {busy ? copy.saving : copy.save}
        </Button>
        <Button variant="outline" size="small" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}
