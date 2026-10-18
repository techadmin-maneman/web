// One list of the job sheet as ops edit it: a checklist or a list of reasons (ADR 0087). Each item's words change
// where they read, and it is moved, taken off or put back by its own buttons, each change saved at once
// (docs/decisions/0212-editing-in-place.md). Every item keeps its code, so a phone holding the old list still sends
// what the API understands. A checklist's item also has the words the client's record shows, empty for a step only the
// technician needs.

import { Button } from "@maneman/ui/Button";
import { EditableRow } from "@maneman/ui/EditableRow";
import { Field, TextInput } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { longDate } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { Answer, JobSheet, JobSheetItemSent, JobSheetList } from "../api.ts";
import { AddForm } from "../components/AddForm.tsx";
import { Refusal } from "../components/Refusal.tsx";
import form from "../components/forms.module.css";
import { EDITING } from "../content/common.ts";
import { settings } from "../content/settings.ts";
import { whoWords } from "../lib/who.ts";
import styles from "./list-editor.module.css";

const copy = settings.jobSheet;

/** An item as the editor reads it: a checklist's also says what the client reads, null for nothing. */
interface ListItem {
  readonly code: string;
  readonly label: string;
  readonly client?: string | null;
}

/** A list as the editor reads it. */
type EditedList = Pick<JobSheetList, "set_by" | "set_at"> & {
  readonly items: readonly ListItem[];
  readonly retired: readonly ListItem[];
};

/** An item as it is sent: a new one has no code yet. */
interface Line {
  readonly code: string | null;
  readonly label: string;
  readonly client?: string | null;
}

/** What a save sends: each item by its code where it has one, a checklist's with the client's words or none. */
const itemsSent = (lines: readonly Line[], withClient: boolean): JobSheetItemSent[] =>
  lines.map((line) => {
    const words = line.code === null ? { label: line.label.trim() } : { code: line.code, label: line.label.trim() };
    if (!withClient) return words;
    const client = (line.client ?? "").trim();
    return { ...words, client: client === "" ? null : client };
  });

const setLineOf = (list: EditedList): string =>
  list.set_by === null || list.set_at === null
    ? copy.committed
    : copy.setBy(whoWords(list.set_by), longDate(list.set_at));

/** The list as a person whose access does not let them change it reads it: its items, in their order. */
export function ListRead({ title, list }: { title: string; list: EditedList }) {
  return (
    <div className={form.group}>
      <h3 className={form.ruleTitle}>{title}</h3>
      <p className={form.set}>{setLineOf(list)}</p>
      <ol className={styles.items}>
        {list.items.map((item) => (
          <li className={styles.item} key={item.code}>
            {item.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface Props {
  readonly id: string;
  readonly title: string;
  readonly list: EditedList;
  readonly most: number;
  readonly longest: number;
  readonly itemLabel: (position: number) => string;
  /** A checklist's: the name of an item's box for the client's words. A list without them has none. */
  readonly clientLabel?: (position: number) => string;
  readonly addLabel: string;
  /** The list's write, which each change sends whole. */
  readonly send: (items: JobSheetItemSent[]) => Promise<Answer<JobSheet>>;
  readonly onSaved: (sheet: JobSheet) => void;
}

/** An item's words: the technician's, and on a checklist the client's beneath them. */
interface Words {
  readonly label: string;
  readonly client: string;
}

function ItemRow(props: {
  readonly item: ListItem;
  readonly position: number;
  readonly editor: Props;
  readonly save: (words: Words) => Promise<string | null>;
}) {
  const { item, position, editor } = props;
  const withClient = editor.clientLabel !== undefined;
  return (
    <EditableRow<Words>
      className={styles.row}
      label={editor.itemLabel(position)}
      words={EDITING}
      value={
        <>
          {item.label}
          {withClient && <span className={styles.clientWords}>{item.client ?? copy.clientNone}</span>}
        </>
      }
      start={() => ({ label: item.label, client: item.client ?? "" })}
      save={props.save}
    >
      {(control, draft, edit) => (
        <span className={styles.boxes}>
          <TextInput
            {...control}
            width="area"
            maxLength={editor.longest}
            value={draft.label}
            onChange={(event) => {
              edit({ ...draft, label: event.target.value });
            }}
          />
          {editor.clientLabel !== undefined && (
            <TextInput
              width="area"
              maxLength={editor.longest}
              aria-label={editor.clientLabel(position)}
              placeholder={copy.clientNone}
              value={draft.client}
              onChange={(event) => {
                edit({ ...draft, client: event.target.value });
              }}
            />
          )}
        </span>
      )}
    </EditableRow>
  );
}

/** A new item, at the list's foot. */
function AddItem(props: { readonly editor: Props; readonly add: (words: Words) => ReturnType<Props["send"]>; readonly onDone: () => void }) {
  const { editor } = props;
  const [words, setWords] = useState<Words>({ label: "", client: "" });
  return (
    <AddForm
      title={editor.addLabel}
      words={{ add: copy.addButton, cancel: copy.cancel }}
      errors={copy.errors}
      boxes={["label", "client"]}
      send={() => props.add(words)}
      onAdded={props.onDone}
      onCancel={props.onDone}
    >
      <div className={form.fields}>
        <Field label={editor.itemLabel(editor.list.items.length + 1)} className={form.field} box="label">
          {(control) => (
            <TextInput
              {...control}
              width="area"
              maxLength={editor.longest}
              value={words.label}
              onChange={(event) => {
                setWords({ ...words, label: event.target.value });
              }}
            />
          )}
        </Field>
        {editor.clientLabel !== undefined && (
          <Field label={editor.clientLabel(editor.list.items.length + 1)} className={form.field} box="client">
            {(control) => (
              <TextInput
                {...control}
                width="area"
                maxLength={editor.longest}
                placeholder={copy.clientNone}
                value={words.client}
                onChange={(event) => {
                  setWords({ ...words, client: event.target.value });
                }}
              />
            )}
          </Field>
        )}
      </div>
    </AddForm>
  );
}

export function ListEditor(props: Props) {
  const { title, list, most, longest } = props;
  const withClient = props.clientLabel !== undefined;
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const errors = {
    ...copy.errors,
    items: copy.limits.items(most),
    label: copy.limits.label(longest),
    client: copy.limits.client(longest),
  };
  const lines: readonly Line[] = list.items;
  const send = async (next: readonly Line[]) => {
    const answer = await props.send(itemsSent(next, withClient));
    if (answer.ok) props.onSaved(answer.body);
    return answer;
  };
  /** A move, a removal or a putting back: sent at once, said beneath the list. */
  const press = (next: readonly Line[]) =>
    once(async () => {
      setSaid(null);
      setRefused(null);
      const answer = await send(next);
      if (answer.ok) setSaid(copy.saved);
      else setRefused(errorText(errors, answer));
    });
  const moved = (from: number, to: number) => {
    const next = [...lines];
    const [line] = next.splice(from, 1);
    if (line !== undefined) next.splice(to, 0, line);
    return next;
  };
  // What is off the list: retired, each able to go back on while there is room.
  const off = list.retired;
  return (
    <section className={form.group} aria-labelledby={`${props.id}-title`}>
      <h3 id={`${props.id}-title`} className={form.ruleTitle}>
        {title}
      </h3>
      <p className={form.set}>{setLineOf(list)}</p>
      {withClient && <p className={form.set}>{copy.clientNote}</p>}
      <ol className={styles.items}>
        {list.items.map((item, index) => {
          const name = item.label;
          return (
            <li className={styles.item} key={item.code}>
              <ItemRow
                item={item}
                position={index + 1}
                editor={props}
                save={async (words) => {
                  const answer = await send(
                    lines.map((line, at) => (at === index ? { ...line, label: words.label, client: words.client } : line)),
                  );
                  return answer.ok ? null : errorText(errors, answer);
                }}
              />
              <span className={styles.moves}>
                <Button
                  variant="quiet"
                  size="small"
                  narrow
                  aria-label={copy.up(name)}
                  disabled={index === 0 || busy}
                  onClick={() => void press(moved(index, index - 1))}
                >
                  {copy.upButton}
                </Button>
                <Button
                  variant="quiet"
                  size="small"
                  narrow
                  aria-label={copy.down(name)}
                  disabled={index === lines.length - 1 || busy}
                  onClick={() => void press(moved(index, index + 1))}
                >
                  {copy.downButton}
                </Button>
                <Button
                  variant="quiet"
                  size="small"
                  narrow
                  aria-label={copy.remove(name)}
                  disabled={busy}
                  onClick={() => void press(lines.filter((_, at) => at !== index))}
                >
                  {copy.removeButton}
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {refused !== null && <Refusal className={form.error} said={refused} />}
      {adding ? (
        <AddItem
          editor={props}
          add={(words) => send([...lines, { code: null, label: words.label, client: words.client }])}
          onDone={() => {
            setAdding(false);
          }}
        />
      ) : (
        <div className={styles.add}>
          <Button
            variant="outline"
            size="small"
            narrow
            disabled={lines.length >= most}
            onClick={() => {
              setAdding(true);
            }}
          >
            {props.addLabel}
          </Button>
        </div>
      )}
      {off.length > 0 && (
        <div className={styles.retired}>
          <p className={styles.retiredTitle}>{copy.retired}</p>
          <ul className={styles.retiredList}>
            {off.map((item) => (
              <li className={styles.retiredItem} key={item.code}>
                <span>{item.label}</span>
                <Button
                  variant="outline"
                  size="small"
                  aria-label={copy.putBack(item.label)}
                  disabled={lines.length >= most || busy}
                  onClick={() => void press([...lines, item])}
                >
                  {copy.putBackButton}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
