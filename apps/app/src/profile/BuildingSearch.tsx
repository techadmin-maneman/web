// The building search on the address form (docs/decisions/0054-address-capture.md).
// The design draws no search; it follows the account section's number field, as the rest of the
// address form does.
//
// One session token covers every keystroke and the save that follows. Google
// bills autocomplete per session where a token groups it and per request where
// it does not, so the token is made once when the form opens and sent again
// with the address. The API refuses a request without one.
//
// A combobox, not a listbox with a text field beside it: the input keeps the
// label and the focus throughout, and the list is described to assistive
// technology through aria-activedescendant. Nothing here is required — a client
// who ignores the search types their address into the fields below.

import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useEffect, useId, useRef, useState } from "react";
import { api, type Suggestion } from "../api.ts";
import { profile } from "../content.ts";
import styles from "./profile.module.css";

/** Waited out before asking Google, so a typed word is one session, not eight. */
const TYPING_PAUSE_MS = 300;
/** Below this, a search returns the whole city and costs a request to say so. */
const SHORTEST_QUERY = 3;

interface ChosenBuilding {
  readonly placeId: string;
  readonly building: string;
}

export function BuildingSearch({
  value,
  sessionToken,
  onChoose,
  onClear,
}: {
  /** The building name in the draft, whether chosen or typed over. */
  readonly value: string;
  readonly sessionToken: string;
  readonly onChoose: (chosen: ChosenBuilding) => void;
  /** Typing after a choice abandons it: the address is then whatever was typed. */
  readonly onClear: () => void;
}) {
  const copy = profile.form.building;
  const listId = useId();
  const optionId = useId();
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "searching" | "unavailable">("idle");
  // What the last answer was for, so a slow reply cannot overwrite a newer one.
  const asked = useRef("");
  const typingPause = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(typingPause.current);
    };
  }, []);

  function ask(query: string) {
    asked.current = query;
    setState("searching");
    void api.addressSuggestions(query, sessionToken).then((answer) => {
      if (asked.current !== query) return;
      if (answer.ok) {
        setSuggestions(answer.body.suggestions);
        setState("idle");
        setOpen(true);
      } else {
        // Google is down, refused or over a ceiling. The form carries on.
        setSuggestions([]);
        setState("unavailable");
      }
      setActive(-1);
    });
  }

  // Only typing searches: a building chosen from the list is not looked up again.
  function searchAfterTyping(typed: string) {
    clearTimeout(typingPause.current);
    const query = typed.trim();
    if (query.length < SHORTEST_QUERY) {
      asked.current = "";
      setSuggestions([]);
      setState("idle");
      return;
    }
    typingPause.current = setTimeout(() => {
      ask(query);
    }, TYPING_PAUSE_MS);
  }

  const shown = open && suggestions.length > 0;

  function choose(index: number) {
    const picked = suggestions[index];
    if (picked === undefined) return;
    clearTimeout(typingPause.current);
    asked.current = "";
    onChoose({ placeId: picked.place_id, building: picked.primary });
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
    <div className={styles.searchField}>
      <label className={styles.formField} htmlFor={`${listId}-input`}>
        <span className={styles.formLabel}>{copy.label}</span>
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
          onClear();
          onChoose({ placeId: "", building: event.target.value });
          searchAfterTyping(event.target.value);
        }}
      />
      {shown && (
        <ul className={styles.suggestions} id={listId} role="listbox" aria-label={copy.label}>
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
              <span className={styles.suggestionName}>{suggestion.primary}</span>
              <span className={styles.suggestionWhere}>{suggestion.secondary}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Google requires their name against suggestions shown without a Google map. */}
      {shown && <p className={styles.attribution}>{copy.attribution}</p>}
      <p className={styles.muted} id={`${listId}-hint`}>
        {state === "unavailable" ? copy.unavailable : copy.hint}
      </p>
      <VisuallyHidden as="p" role="status">
        {state === "searching" || !shown ? "" : copy.found(suggestions.length)}
      </VisuallyHidden>
    </div>
  );
}
