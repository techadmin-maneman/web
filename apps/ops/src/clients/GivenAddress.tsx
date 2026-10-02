// An address a client gives ops on the phone, recorded on their page and saved
// as theirs, marked as given to ops (docs/decisions/0092-task-owners.md; open
// point 62). The form follows the client app's own (apps/app/src/profile/AddressForm.tsx):
// the same fields and checks, and the same building search, whose one session
// token covers every keystroke and the save, so Google bills the search once
// (docs/decisions/0054-address-capture.md). The search is an addition, never a
// gate: an address typed without it saves, with no pin. No board draws any of it.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useEffect, useId, useRef, useState } from "react";
import { api, type AddressGiven, type ClientRecord, type Suggestion } from "../api.ts";
import { clients, NOT_PERMITTED } from "../content.ts";
import styles from "./address.module.css";

const copy = clients.visits.given;

/** Waited out before asking Google, so a typed word is one request, not eight. */
const TYPING_PAUSE_MS = 300;
/** Below this, a search returns the whole city and costs a request to say so. */
const SHORTEST_QUERY = 3;

type Draft = Omit<AddressGiven, "session_token">;
type Part = Exclude<keyof Draft, "place_id" | "building">;

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

const given = (part: string | null | undefined): part is string =>
  part !== null && part !== undefined && part.trim() !== "";

/** A part left blank is none, as the API holds it. */
const orNull = (part: string | null | undefined): string | null => (given(part) ? part.trim() : null);

/** The fields an address is not one without, left out, as the app's form checks them. */
function missing(draft: Draft): Part[] {
  const left: Part[] = [];
  if (!given(draft.flat)) left.push("flat");
  if (draft.line1.trim() === "") left.push("line1");
  if (draft.locality.trim() === "") left.push("locality");
  if (draft.city.trim() === "") left.push("city");
  if (!/^\d{6}$/.test(draft.pincode.trim())) left.push("pincode");
  return left;
}

/** The building search: a combobox whose list is described through aria-activedescendant, as the app's is. */
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
  onChoose: (chosen: Suggestion) => void;
}) {
  const searchCopy = copy.building;
  const listId = useId();
  const optionId = useId();
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "searching" | "unavailable">("idle");
  // What the last answer was for, so a slow reply cannot overwrite a newer one.
  const asked = useRef("");

  useEffect(() => {
    const query = value.trim();
    if (query.length < SHORTEST_QUERY) {
      setSuggestions([]);
      setState("idle");
      return;
    }
    const timer = setTimeout(() => {
      asked.current = query;
      setState("searching");
      void api.addressSuggestions(clientId, query, sessionToken).then((answer) => {
        if (asked.current !== query) return;
        setSuggestions(answer.ok ? answer.body.suggestions : []);
        setState(answer.ok ? "idle" : "unavailable");
        setOpen(answer.ok);
        setActive(-1);
      });
    }, TYPING_PAUSE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [clientId, value, sessionToken]);

  const shown = open && suggestions.length > 0;

  function choose(index: number) {
    const picked = suggestions[index];
    if (picked === undefined) return;
    onChoose(picked);
    setSuggestions([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (!shown) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((was) => (was + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && active >= 0) {
      // Only when an option is highlighted; otherwise Enter submits the form.
      event.preventDefault();
      choose(active);
    }
  }

  return (
    <div className={styles.search}>
      <label className={styles.label} htmlFor={`${listId}-input`}>
        {searchCopy.label}
      </label>
      <input
        id={`${listId}-input`}
        className={styles.input}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={`${listId}-hint`}
        aria-activedescendant={shown && active >= 0 ? `${optionId}-${String(active)}` : undefined}
        value={value}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          onType(event.target.value);
        }}
      />
      {shown && (
        <ul className={styles.suggestions} id={listId} role="listbox" aria-label={searchCopy.label}>
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.place_id}
              id={`${optionId}-${String(index)}`}
              className={index === active ? styles.suggestionActive : styles.suggestion}
              role="option"
              aria-selected={index === active}
              // A listbox option is not a button; the input keeps the focus.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
            >
              <span>{suggestion.primary}</span>
              <span className={styles.where}>{suggestion.secondary}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Google requires their name against suggestions shown without a Google map. */}
      {shown && <p className={styles.hint}>{searchCopy.attribution}</p>}
      <p className={styles.hint} id={`${listId}-hint`}>
        {state === "unavailable" ? searchCopy.unavailable : searchCopy.hint}
      </p>
      <VisuallyHidden as="p" role="status">
        {state === "searching" || !shown ? "" : searchCopy.found(suggestions.length)}
      </VisuallyHidden>
    </div>
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
  const [invalid, setInvalid] = useState<readonly Part[]>([]);
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
      const left = missing(sent);
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

  const field = (key: Part, label: string, options: { inputMode?: "numeric"; required?: boolean } = {}) => {
    const wrong = invalid.includes(key);
    return (
      <Field label={label} error={wrong ? copy.invalid : null}>
        {(control) => (
          <TextInput
            {...control}
            className={styles.input}
            inputMode={options.inputMode}
            required={options.required}
            value={draft[key] ?? ""}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((was) => ({ ...was, [key]: value }));
            }}
          />
        )}
      </Field>
    );
  };

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
      <h3 className={styles.title} id={`${formId}-title`}>
        {copy.title}
      </h3>
      <p className={styles.hint}>{copy.note}</p>
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
      {field("flat", copy.flat, { required: true })}
      {field("floor", copy.floor)}
      {field("tower", copy.tower)}
      {/* Only for an address nobody searched for: otherwise the building is line one. */}
      {!given(draft.building) && field("line1", copy.line1, { required: true })}
      {field("line2", copy.line2)}
      {field("landmark", copy.landmark)}
      {field("locality", copy.locality, { required: true })}
      {field("city", copy.city, { required: true })}
      {field("pincode", copy.pincode, { inputMode: "numeric", required: true })}
      {field("access_notes", copy.accessNotes)}
      <p className={styles.hint}>{copy.accessHint}</p>
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
