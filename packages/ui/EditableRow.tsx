// One value of a record or a setting on a line of its own, changed where it reads (docs/decisions/0212-editing-in-place.md).
// Its name at the left and its value as words at the right; a click on the value, or Enter on it, opens its box in
// place, already focused. Enter or Save keeps the change, Escape or Cancel puts it back, and focus returns to the
// value. One value saves at a time: "Saved" shows beside it, and a refusal shows under the box in its own words, the
// box still open. For a person who may only look, the value reads plainly, with nothing to press.
//
//   <EditableRow label={copy.length} value={`${minutes} min`} words={EDITING} start={() => String(minutes)}
//     save={(typed) => saveLength(typed)}>
//     {(control, typed, type) => <NumberInput {...control} width="figure" value={typed} onChange={…} />}
//   </EditableRow>
//
// `save` answers null once the change is kept, or the words of why it was not.

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { GLYPHS } from "@maneman/brand/icons";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { InlineMessage } from "./InlineMessage.tsx";
import { classes } from "./classes.ts";
import type { FieldControl } from "./Field.tsx";
import { useOneAtATime } from "./useOneAtATime.ts";
import styles from "./editable-row.module.css";

/** The words a row says, in each app's own. */
export interface EditingWords {
  /** Read with the value's name, for a screen reader: "Change". */
  readonly change: string;
  readonly save: string;
  readonly cancel: string;
  readonly saved: string;
}

/** How long "Saved" stays beside the value, in milliseconds. */
const SAVED_FOR = 4000;

interface EditableRowProps<Draft> {
  readonly label: string;
  /** The value as it reads: "90 minutes", "Rs. 2,200 from 1 Nov". */
  readonly value: ReactNode;
  readonly words: EditingWords;
  /** False for a person who may only look. */
  readonly mayChange?: boolean;
  /** What the box holds as it opens: the value as it stands. */
  readonly start: () => Draft;
  /** Keeps the change: null once kept, else the words of why not. */
  readonly save: (draft: Draft) => Promise<string | null>;
  /** The box, or boxes, given the control's ids, the draft and the way to change it. */
  readonly children: (control: FieldControl, draft: Draft, setDraft: (next: Draft) => void) => ReactNode;
  /** What the figure counts, after the box: "minutes". */
  readonly unit?: string | undefined;
  /** The row's id, which a link to it names. */
  readonly id?: string | undefined;
  /** Opened already, its box holding `start`: as a line opens on an earlier wording chosen from its history. */
  readonly opened?: boolean;
  readonly className?: string | undefined;
}

/** A row's state: the draft while its box is open, what was refused, whether it just saved, and the focus between. */
function useEditing<Draft>(start: () => Draft, save: (draft: Draft) => Promise<string | null>, opened: boolean) {
  const [draft, setDraft] = useState<Draft | null>(() => (opened ? start() : null));
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, once] = useOneAtATime();
  const valueButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const returning = useRef(false);
  const editing = draft !== null;

  const close = () => {
    returning.current = true;
    setRefusal(null);
    setDraft(null);
  };
  // Opened, the box takes the keyboard and Escape closes it; closed, the value takes the keyboard back.
  useEffect(() => {
    if (!editing) {
      if (returning.current) valueButton.current?.focus();
      returning.current = false;
      return;
    }
    const editor = form.current;
    editor?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    editor?.addEventListener("keydown", escape);
    return () => {
      editor?.removeEventListener("keydown", escape);
    };
  }, [editing]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => {
      setSaved(false);
    }, SAVED_FOR);
    return () => {
      clearTimeout(timer);
    };
  }, [saved]);

  const open = () => {
    setRefusal(null);
    setSaved(false);
    setDraft(start());
  };
  const keep = () =>
    once(async () => {
      if (draft === null) return;
      const why = await save(draft);
      if (why !== null) {
        setRefusal(why);
        return;
      }
      setSaved(true);
      close();
    });
  return { draft, setDraft, refusal, saved, busy, valueButton, form, open, close, keep };
}

/** The value as it reads: its own button, which opens it, and "Saved" beside it once a change is kept. */
function Reading(props: {
  readonly label: string;
  readonly value: ReactNode;
  readonly words: EditingWords;
  readonly saved: boolean;
  readonly valueButton: RefObject<HTMLButtonElement | null>;
  readonly onOpen: () => void;
}) {
  const nowId = useId();
  return (
    <span className={styles.reading}>
      <button
        ref={props.valueButton}
        type="button"
        className={styles.value}
        aria-label={`${props.words.change} ${props.label}`}
        aria-describedby={nowId}
        onClick={props.onOpen}
      >
        <span id={nowId}>{props.value}</span>
        <Icon className={styles.cue} d={GLYPHS.edit} size="xs" />
      </button>
      {props.saved && (
        <InlineMessage tone="saved" className={styles.saved}>
          {props.words.saved}
        </InlineMessage>
      )}
    </span>
  );
}

export function EditableRow<Draft>({
  label,
  value,
  words,
  mayChange = true,
  start,
  save,
  children,
  unit,
  id,
  className,
  opened = false,
}: EditableRowProps<Draft>) {
  const boxId = useId();
  const errorId = useId();
  const row = useEditing(start, save, opened);

  if (!mayChange || row.draft === null) {
    return (
      <div className={classes(styles.row, className)} id={id}>
        <span className={styles.label}>{label}</span>
        {mayChange ? (
          <Reading
            label={label}
            value={value}
            words={words}
            saved={row.saved}
            valueButton={row.valueButton}
            onOpen={row.open}
          />
        ) : (
          <span className={styles.value}>{value}</span>
        )}
      </div>
    );
  }

  const control: FieldControl = {
    id: boxId,
    "aria-describedby": row.refusal === null ? undefined : errorId,
    "aria-invalid": row.refusal === null ? undefined : true,
  };
  return (
    <form
      ref={row.form}
      className={classes(styles.row, styles.editing, className)}
      id={id}
      // The row says what will not hold in its own words, under the box, rather than the browser in a bubble.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void row.keep();
      }}
    >
      <label className={styles.label} htmlFor={boxId}>
        {label}
      </label>
      <span className={styles.edit}>
        <span className={styles.boxes}>
          {children(control, row.draft, row.setDraft)}
          {unit !== undefined && <span className={styles.unit}>{unit}</span>}
        </span>
        <span className={styles.actions}>
          <Button variant="primary" size="small" type="submit" busy={row.busy}>
            {words.save}
          </Button>
          <Button variant="quiet" size="small" narrow onClick={row.close}>
            {words.cancel}
          </Button>
        </span>
        {row.refusal !== null && (
          <InlineMessage tone="error" id={errorId} className={styles.refusal}>
            {row.refusal}
          </InlineMessage>
        )}
      </span>
    </form>
  );
}
