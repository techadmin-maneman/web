// One value of a record or a setting on a line of its own (docs/decisions/0314-change-everywhere-and-forms-in-a-grid.md):
// its name, its value as words, and Change. On a page Change opens the value's box in a small dialog of its own; in a
// drawer, where no dialog opens over it, the box opens in the row's place. Either way the box is focused as it opens,
// Enter or Save keeps the change, Escape or Cancel puts it back, and focus returns to Change. One value saves at a
// time: "Saved" shows beside it, and a refusal shows under the box in its own words, the box still open. For a person
// who may only look, the row reads without Change.
//
//   <EditableRow label={copy.length} value={`${minutes} min`} words={EDITING} start={() => String(minutes)}
//     save={(typed) => saveLength(typed)}>
//     {(control, typed, type) => <NumberInput {...control} width="figure" value={typed} onChange={…} />}
//   </EditableRow>
//
// `save` answers null once the change is kept, or the words of why it was not.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { useContext, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { StackedRows } from "./stacked-rows.ts";
import { ChangeInDialog } from "./change-in-dialog.ts";
import { Dialog } from "./Dialog.tsx";
import { Button } from "./Button.tsx";
import { TextButton } from "./TextLink.tsx";
import { InlineMessage } from "./InlineMessage.tsx";
import { classes } from "./classes.ts";
import type { FieldControl } from "./Field.tsx";
import { useOneAtATime } from "./useOneAtATime.ts";
import styles from "./editable-row.module.css";

/** The words a row says, in each app's own. */
export interface EditingWords {
  /** The button that opens a value, read with its name: "Change". */
  readonly change: string;
  readonly save: string;
  readonly cancel: string;
  readonly saved: string;
  /** Before the value as it stands, in a setting's dialog: "Now". */
  readonly now?: string;
}

/** How long "Saved" stays beside the value, in milliseconds. */
const SAVED_FOR = 4000;

interface EditableRowProps<Draft> {
  readonly label: string;
  /** The value as it reads: "90 minutes", "Rs. 2,200 from 1 Nov". */
  readonly value: ReactNode;
  /** The value as the dialog's Now says it, where the row says more beside it, as what it was before. */
  readonly now?: ReactNode;
  /** A line beneath its name as it reads, as how far a target has come. */
  readonly note?: ReactNode;
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
  /** Its name above its value, as rows two to a row stand; inside SettingPairs it is, unless told otherwise. */
  readonly stacked?: boolean;
}

/** A row's state: the draft while its box is open, what was refused, whether it just saved, and the focus between. */
function useEditing<Draft>(start: () => Draft, save: (draft: Draft) => Promise<string | null>, opened: boolean) {
  const [draft, setDraft] = useState<Draft | null>(() => (opened ? start() : null));
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, once] = useOneAtATime();
  const changeButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const returning = useRef(false);
  const editing = draft !== null;

  const close = () => {
    returning.current = true;
    setRefusal(null);
    setDraft(null);
  };
  // Opened, the box takes the keyboard; closed, Change takes the keyboard back.
  useEffect(() => {
    if (!editing) {
      if (returning.current) changeButton.current?.focus();
      returning.current = false;
      return;
    }
    form.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, [editing]);
  // Escape puts the value back, but not while a save is on its way: what it answers is never lost.
  useEffect(() => {
    const editor = form.current;
    if (!editing || editor === null) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (!busy) close();
    };
    editor.addEventListener("keydown", escape);
    return () => {
      editor.removeEventListener("keydown", escape);
    };
  }, [editing, busy]);
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
  /** Cancel, Escape or the dialog dismissed: the value put back, once any save on its way has answered. */
  const dismiss = () => {
    if (!busy) close();
  };
  return { draft, setDraft, refusal, saved, busy, changeButton, form, open, dismiss, keep };
}

/**
 * The row as it reads: its name, its value, and Change for a person who may change it, "Saved" beside once a change
 * is kept. On a page it is drawn as the redesign draws a setting, the value and Change at the row's end; in a drawer
 * its name stands quiet in its column and Change at the row's end. `children` is Change's dialog, where it has one.
 */
function ReadingRow(props: {
  readonly label: string;
  readonly note?: ReactNode;
  readonly value: ReactNode;
  readonly words: EditingWords;
  /** What Change does; null for a person who may only look. */
  readonly onOpen: (() => void) | null;
  readonly saved: boolean;
  readonly changeButton?: RefObject<HTMLButtonElement | null>;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}) {
  const onPage = useContext(ChangeInDialog);
  const valueId = useId();
  return (
    <div className={classes(styles.row, onPage && styles.setting, props.className)} id={props.id}>
      {props.note === undefined ? (
        <span className={styles.label}>{props.label}</span>
      ) : (
        <span className={styles.naming}>
          <span className={styles.label}>{props.label}</span>
          <span className={styles.note}>{props.note}</span>
        </span>
      )}
      <span className={styles.reading}>
        <span id={valueId} className={styles.shown}>
          {props.value}
        </span>
        {props.onOpen !== null && (
          <TextButton
            ref={props.changeButton}
            className={styles.change}
            icon={ACTION_ICONS.pencil}
            aria-label={`${props.words.change} ${props.label}`}
            aria-describedby={valueId}
            onClick={props.onOpen}
          >
            {props.words.change}
          </TextButton>
        )}
        {props.saved && (
          <InlineMessage tone="saved" className={styles.saved}>
            {props.words.saved}
          </InlineMessage>
        )}
      </span>
      {props.children}
    </div>
  );
}

type Editing<Draft> = ReturnType<typeof useEditing<Draft>>;

interface OpenProps<Draft> {
  readonly label: string;
  readonly value: ReactNode;
  readonly words: EditingWords;
  readonly unit: string | undefined;
  readonly row: Editing<Draft>;
  readonly children: EditableRowProps<Draft>["children"];
}

/** The box's ids, and its refusal's, for the control a row's children are given. */
function useControl(refused: boolean): { readonly control: FieldControl; readonly errorId: string } {
  const boxId = useId();
  const errorId = useId();
  return {
    errorId,
    control: {
      id: boxId,
      "aria-describedby": refused ? errorId : undefined,
      "aria-invalid": refused ? true : undefined,
    },
  };
}

/** The row opened in place: its box beside its name, Save and Cancel, and why a change was refused beneath. */
function InlineEditing<Draft>(props: OpenProps<Draft> & { readonly id?: string; readonly className?: string }) {
  const { row, words, unit } = props;
  const { control, errorId } = useControl(row.refusal !== null);
  if (row.draft === null) return null;
  return (
    <form
      ref={row.form}
      className={classes(styles.row, styles.editing, props.className)}
      id={props.id}
      // The row says what will not hold in its own words, under the box, rather than the browser in a bubble.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void row.keep();
      }}
    >
      <label className={styles.label} htmlFor={control.id}>
        {props.label}
      </label>
      <span className={styles.edit}>
        <span className={styles.boxes}>
          {props.children(control, row.draft, row.setDraft)}
          {unit !== undefined && <span className={styles.unit}>{unit}</span>}
        </span>
        <span className={styles.actions}>
          <Button variant="primary" size="small" type="submit" busy={row.busy} icon={ACTION_ICONS.check}>
            {words.save}
          </Button>
          <Button variant="quiet" size="small" narrow disabled={row.busy} icon={ACTION_ICONS.x} onClick={row.dismiss}>
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

/** Change's dialog: the setting's box under its name, why a change was refused, the value now, Cancel and Save. */
function ChangeDialog<Draft>({ label, value, words, unit, row, children }: OpenProps<Draft>) {
  const titleId = useId();
  const { control, errorId } = useControl(row.refusal !== null);
  if (row.draft === null) return null;
  return (
    <Dialog labelledBy={titleId} className={styles.dialog} canClose={!row.busy} onDismiss={row.dismiss}>
      <form
        ref={row.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void row.keep();
        }}
      >
        <h2 id={titleId} className={styles.dialogTitle}>
          <label htmlFor={control.id}>{label}</label>
        </h2>
        <span className={styles.boxes}>
          {children(control, row.draft, row.setDraft)}
          {unit !== undefined && <span className={styles.unit}>{unit}</span>}
        </span>
        {row.refusal !== null && (
          <InlineMessage tone="error" id={errorId} className={styles.refusal}>
            {row.refusal}
          </InlineMessage>
        )}
        {words.now !== undefined && (
          <p className={styles.now}>
            {words.now}: {value}
          </p>
        )}
        <span className={styles.dialogActions}>
          <Button variant="quiet" size="small" disabled={row.busy} icon={ACTION_ICONS.x} onClick={row.dismiss}>
            {words.cancel}
          </Button>
          <Button variant="primary" size="small" type="submit" busy={row.busy} icon={ACTION_ICONS.check}>
            {words.save}
          </Button>
        </span>
      </form>
    </Dialog>
  );
}

export function EditableRow<Draft>({
  label,
  value,
  now,
  note,
  words,
  mayChange = true,
  start,
  save,
  children,
  unit,
  id,
  className,
  opened = false,
  stacked: asked,
}: EditableRowProps<Draft>) {
  const inPairs = useContext(StackedRows);
  const onPage = useContext(ChangeInDialog);
  // Name above value only in a drawer's pairs: on a page every row stands one to a line, as a setting does.
  const look = classes(!onPage && (asked ?? inPairs) && styles.stacked, className);
  const row = useEditing(start, save, opened);

  if (!mayChange || onPage || row.draft === null) {
    return (
      <ReadingRow
        label={label}
        note={note}
        value={value}
        words={words}
        onOpen={mayChange ? row.open : null}
        saved={row.saved}
        changeButton={row.changeButton}
        id={id}
        className={look}
      >
        {onPage && mayChange && (
          <ChangeDialog label={label} value={now ?? value} words={words} unit={unit} row={row}>
            {children}
          </ChangeDialog>
        )}
      </ReadingRow>
    );
  }

  return (
    <InlineEditing label={label} value={value} words={words} unit={unit} row={row} id={id} className={look}>
      {children}
    </InlineEditing>
  );
}

/**
 * A value changed somewhere bigger than its row, as an address in a drawer: it reads, and opens from its Change, as an
 * EditableRow's does, so every row of a record is changed the one way.
 */
export function OpenRow(props: {
  readonly label: string;
  readonly value: ReactNode;
  readonly words: EditingWords;
  readonly mayChange: boolean;
  readonly onOpen: () => void;
}) {
  const stacked = useContext(StackedRows);
  return (
    <ReadingRow
      label={props.label}
      value={props.value}
      words={props.words}
      onOpen={props.mayChange ? props.onOpen : null}
      saved={false}
      className={classes(stacked && styles.stacked)}
    />
  );
}
