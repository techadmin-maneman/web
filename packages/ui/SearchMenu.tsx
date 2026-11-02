// A search box whose results open in a panel beneath it, under their groups' names (WAI-ARIA's combobox with a
// listbox): the console's search, in its header and on a phone's search sheet. The arrow keys move through the
// results, Enter opens the one moved to or the first, Escape closes the panel and a press outside it too.
//
//   <SearchMenu label={copy.search} value={text} onChange={setText} none={copy.none}
//     groups={[{ key: "clients", name: copy.clients, results: [{ key, label, detail, onChoose }] }]} />

import { GLYPHS } from "@maneman/brand/icons";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { classes } from "./classes.ts";
import { Field, TextInput } from "./Field.tsx";
import { Icon } from "./Icon.tsx";
import styles from "./search-menu.module.css";
import boxStyles from "./search-input.module.css";

export interface SearchResult {
  readonly key: string;
  readonly label: ReactNode;
  /** A figure about it at the right: a mobile number, a city. */
  readonly detail?: ReactNode;
  readonly onChoose: () => void;
}

export interface SearchGroup {
  readonly key: string;
  /** Its name over its results; none drawn without one. */
  readonly name?: string | undefined;
  readonly results: readonly SearchResult[];
}

/** Whether the panel is open, the result moved to, and the box's keys: arrows to move, Enter to open, Escape out. */
function useMenu(value: string, results: readonly SearchResult[], alwaysOpen: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(false);
  const [active, setActive] = useState(-1);
  const open = alwaysOpen || (opened && (value.trim() !== "" || results.length > 0));
  useEffect(() => {
    setActive(-1);
  }, [value]);
  useEffect(() => {
    if (!opened || alwaysOpen) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpened(false);
    };
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("pointerdown", away);
    };
  }, [opened, alwaysOpen]);
  const choose = (result: SearchResult | undefined) => {
    if (result === undefined) return;
    setOpened(false);
    result.onChoose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpened(true);
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((now) => (now + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active] ?? results[0]);
    } else if (event.key === "Escape" && open && !alwaysOpen) {
      event.stopPropagation();
      setOpened(false);
    }
  };
  return {
    root,
    open,
    active,
    choose,
    onKeyDown,
    show: () => {
      setOpened(true);
    },
  };
}

/** The panel: each group's name over its results, the one moved to marked; a line where nothing is found. */
function Results({
  id,
  label,
  groups,
  active,
  onChoose,
}: {
  readonly id: string;
  readonly label: string;
  readonly groups: readonly SearchGroup[];
  readonly active: number;
  readonly onChoose: (result: SearchResult) => void;
}) {
  let at = -1;
  return (
    <div id={`${id}-list`} role="listbox" aria-label={label}>
      {groups.map((group) => (
        <div key={group.key} role="group" aria-labelledby={group.name === undefined ? undefined : `${id}-${group.key}`}>
          {group.name !== undefined && (
            <p className={styles.heading} id={`${id}-${group.key}`} role="presentation">
              {group.name}
            </p>
          )}
          {group.results.map((result) => {
            at += 1;
            return (
              <button
                key={result.key}
                type="button"
                id={optionId(id, at)}
                role="option"
                tabIndex={-1}
                aria-selected={at === active}
                className={styles.option}
                onPointerDown={(event) => {
                  // The box keeps the keyboard, so the panel stays open until the choice is made.
                  event.preventDefault();
                }}
                onClick={() => {
                  onChoose(result);
                }}
              >
                <span className={styles.label}>{result.label}</span>
                {result.detail !== undefined && <span className={styles.detail}>{result.detail}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const optionId = (id: string, at: number) => `${id}-option-${String(at)}`;

export function SearchMenu({
  label,
  value,
  onChange,
  groups,
  none,
  keyHint,
  open: alwaysOpen = false,
  inputRef,
  className,
}: {
  /** The box's name, read out and shown in it until typed in. */
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The results so far, by group, in their order; a group with none is left out. */
  readonly groups: readonly SearchGroup[];
  /** Said in the panel when the words find nothing. */
  readonly none: string;
  /** The key that takes the keyboard to the box, shown at its end while it is empty. */
  readonly keyHint?: string;
  /** The panel stays open beneath the box, as on a phone's search sheet, where the results are the page. */
  readonly open?: boolean;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly className?: string | undefined;
}) {
  const id = useId();
  const shown = groups.filter((group) => group.results.length > 0);
  const results = shown.flatMap((group) => group.results);
  const menu = useMenu(value, results, alwaysOpen);
  return (
    <div className={classes(styles.root, className)} ref={menu.root}>
      <Field label={label} labelHidden className={boxStyles.search}>
        {(control) => (
          <div className={boxStyles.box}>
            <Icon className={boxStyles.icon} d={GLYPHS.search} size="xs" />
            <TextInput
              {...control}
              ref={inputRef}
              type="search"
              className={classes(boxStyles.input, keyHint !== undefined && styles.hinted)}
              role="combobox"
              aria-expanded={menu.open}
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={menu.active >= 0 ? optionId(id, menu.active) : undefined}
              autoComplete="off"
              value={value}
              placeholder={label}
              onFocus={menu.show}
              onKeyDown={menu.onKeyDown}
              onChange={(event) => {
                menu.show();
                onChange(event.currentTarget.value);
              }}
            />
            {keyHint !== undefined && value === "" && (
              <kbd className={styles.key} aria-hidden="true">
                {keyHint}
              </kbd>
            )}
          </div>
        )}
      </Field>
      <div className={classes(styles.panel, alwaysOpen && styles.inPlace)} hidden={!menu.open}>
        <Results id={id} label={label} groups={shown} active={menu.active} onChoose={menu.choose} />
        {value.trim() !== "" && results.length === 0 && <p className={styles.none}>{none}</p>}
      </div>
    </div>
  );
}
