// The building search on an address form, the client app's and the console's (docs/decisions/0054-address-capture.md).
//
// One session token covers every keystroke and the save that follows: Google bills autocomplete per session where a
// token groups it and per request where it does not, so the caller makes the token once and its `search` sends it.
//
// A combobox, not a listbox with a text field beside it: the input keeps the label and the focus throughout, and the
// list is described to assistive technology through aria-activedescendant. Nothing here is required: an address can
// always be typed into the fields below it.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Label, TextInput } from "./Field.tsx";
import { VisuallyHidden } from "./VisuallyHidden.tsx";
import { classes } from "./classes.ts";
import styles from "./address-search.module.css";

/** Waited out before asking Google, so a typed word is one session, not eight. */
const TYPING_PAUSE_MS = 300;
/** Below this, a search returns the whole city and costs a request to say so. */
const SHORTEST_QUERY = 3;

export interface AddressSuggestion {
  readonly place_id: string;
  /** The building, as the client will recognise it. */
  readonly primary: string;
  /** Where it is, beneath the name. */
  readonly secondary: string;
}

/** What the search answered: the suggestions, or nothing, when Google is down, refused or over a ceiling. */
export type SearchAnswer =
  { readonly ok: true; readonly suggestions: readonly AddressSuggestion[] } | { readonly ok: false };

export interface AddressSearchWords {
  readonly label: string;
  /** The line beneath the field; null to show a line only when the search is unavailable. */
  readonly hint: string | null;
  readonly unavailable: string;
  /** Google's name against suggestions shown without a Google map, which their terms require. */
  readonly attribution: string;
  readonly found: (count: number) => string;
}

/** The search's state and what each keystroke, answer and choice does to it. */
function useSuggestions(
  search: (query: string) => Promise<SearchAnswer>,
  onChoose: (chosen: AddressSuggestion) => void,
) {
  const [suggestions, setSuggestions] = useState<readonly AddressSuggestion[]>([]);
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

  const ask = (query: string) => {
    asked.current = query;
    setState("searching");
    void search(query).then((answer) => {
      if (asked.current !== query) return;
      setSuggestions(answer.ok ? answer.suggestions : []);
      setState(answer.ok ? "idle" : "unavailable");
      setOpen(answer.ok);
      setActive(-1);
    });
  };

  // Only typing searches: a building chosen from the list is not looked up again.
  const searchAfterTyping = (typed: string) => {
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
  };

  const shown = open && suggestions.length > 0;

  const choose = (index: number) => {
    const picked = suggestions[index];
    if (picked === undefined) return;
    clearTimeout(typingPause.current);
    asked.current = "";
    onChoose(picked);
    setSuggestions([]);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
  };

  return { suggestions, active, state, shown, searchAfterTyping, choose, onKeyDown };
}

export function AddressSearch(props: {
  /** The building in the draft, whether chosen or typed over. */
  readonly value: string;
  readonly search: (query: string) => Promise<SearchAnswer>;
  /** Typing after a choice abandons it: the building is then whatever was typed, with no pin. */
  readonly onType: (typed: string) => void;
  readonly onChoose: (chosen: AddressSuggestion) => void;
  readonly words: AddressSearchWords;
  /** The search's place in its form. */
  readonly className?: string | undefined;
}) {
  const { words } = props;
  const listId = useId();
  const optionId = useId();
  const { suggestions, active, state, shown, searchAfterTyping, choose, onKeyDown } = useSuggestions(
    props.search,
    props.onChoose,
  );
  const hint = state === "unavailable" ? words.unavailable : words.hint;

  return (
    <div className={classes(styles.field, props.className)}>
      <Label htmlFor={`${listId}-input`}>{words.label}</Label>
      <TextInput
        id={`${listId}-input`}
        role="combobox"
        autoComplete="off"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={`${listId}-hint`}
        aria-activedescendant={shown && active >= 0 ? `${optionId}-${String(active)}` : undefined}
        value={props.value}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          props.onType(event.target.value);
          searchAfterTyping(event.target.value);
        }}
      />
      {shown && (
        <ul className={styles.suggestions} id={listId} role="listbox" aria-label={words.label}>
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.place_id}
              id={`${optionId}-${String(index)}`}
              className={classes(styles.suggestion, index === active && styles.active)}
              role="option"
              aria-selected={index === active}
              // A listbox option is not a button; the input keeps the focus.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
            >
              <span className={styles.name}>{suggestion.primary}</span>
              <span className={styles.where}>{suggestion.secondary}</span>
            </li>
          ))}
        </ul>
      )}
      {shown && <p className={styles.attribution}>{words.attribution}</p>}
      {hint !== null && (
        <p className={styles.hint} id={`${listId}-hint`}>
          {hint}
        </p>
      )}
      <VisuallyHidden as="p" role="status">
        {state === "searching" || !shown ? "" : words.found(suggestions.length)}
      </VisuallyHidden>
    </div>
  );
}
