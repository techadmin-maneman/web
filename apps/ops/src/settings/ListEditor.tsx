// One list of the job sheet as ops edit it: a checklist or the partial reasons (ADR 0087). Items are renamed, moved,
// taken off or put back, each keeping its code, so a phone holding the old list still sends what the API understands.
// A checklist's item also has the words the client's record shows, empty for a step only the technician needs. The
// check shows what changes first (ADR 0071).

import { TextInput } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { longDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import type { Answer, JobSheet, JobSheetItemSent, JobSheetList } from "../api.ts";
import { settings } from "../content/settings.ts";
import { whoWords } from "../lib/who.ts";
import { review } from "../content/common.ts";
import styles from "./list-editor.module.css";
import form from "../components/forms.module.css";
import { SettingForm, sentOf, useSteps } from "./SettingForm.tsx";
import { FormActions } from "../components/FormActions.tsx";

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

/**
 * An item as it is edited: a new one has no code yet, and every one a key React can follow as it moves. A
 * checklist's has the client's words, empty for none; a list of reasons has none to give.
 */
interface Line {
  readonly key: string;
  readonly code: string | null;
  readonly label: string;
  readonly client: string | null;
}

const lineOf = (item: ListItem, withClient: boolean): Line => ({
  key: item.code,
  code: item.code,
  label: item.label,
  client: withClient ? (item.client ?? "") : null,
});

const linesOf = (list: EditedList, withClient: boolean): Line[] => list.items.map((item) => lineOf(item, withClient));

/** What an item's client words become, where they change: "" for none. */
function clientChange(line: Line, before: ListItem | undefined): string[] {
  if (line.client === null) return [];
  const now = line.client.trim();
  if (before !== undefined && (before.client ?? "") === now) return [];
  const name = line.label.trim();
  return [now === "" ? copy.confirm.clientNone(name) : copy.confirm.clientReads(name, now)];
}

/** What the change is: each item added, renamed, reworded for the client or taken off, and whether the order moves. */
function changesOf(list: EditedList, lines: readonly Line[]): string[] {
  const { confirm } = copy;
  const was = new Map(list.items.map((item) => [item.code, item]));
  const kept = new Set(lines.flatMap((line) => (line.code === null ? [] : [line.code])));
  const changes = [
    ...lines.flatMap((line) => {
      const before = line.code === null ? undefined : was.get(line.code);
      const label = line.label.trim();
      if (before === undefined) return [confirm.added(label), ...clientChange(line, before)];
      const renamed = before.label === label ? [] : [confirm.renamed(before.label, label)];
      return [...renamed, ...clientChange(line, before)];
    }),
    ...list.items.filter((item) => !kept.has(item.code)).map((item) => confirm.takenOff(item.label)),
  ];
  const order = lines.flatMap((line) => (line.code !== null && was.has(line.code) ? [line.code] : []));
  const before = list.items.map((item) => item.code).filter((code) => kept.has(code));
  if (order.join() !== before.join()) changes.push(confirm.moved);
  return changes;
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
  /** The list's write, which the form's steps send once its change is confirmed. */
  readonly send: (items: JobSheetItemSent[]) => Promise<Answer<JobSheet>>;
  /** This list, out of the sheet the save answers with. */
  readonly pick: (sheet: JobSheet) => EditedList;
  readonly onSaved: (sheet: JobSheet) => void;
}

function Item({
  line,
  index,
  count,
  id,
  props,
  onLabel,
  onClient,
  onMove,
  onRemove,
}: {
  line: Line;
  index: number;
  count: number;
  id: string;
  props: Props;
  onLabel: (label: string) => void;
  onClient: (client: string) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const name = line.label.trim() === "" ? copy.unnamed : line.label.trim();
  return (
    <li className={styles.item}>
      <TextInput
        className={styles.label}
        id={`${id}-${line.key}`}
        maxLength={props.longest}
        aria-label={props.itemLabel(index + 1)}
        value={line.label}
        onChange={(event) => {
          onLabel(event.target.value);
        }}
      />
      <Button
        variant="outline"
        size="small"
        aria-label={copy.up(name)}
        disabled={index === 0}
        onClick={() => {
          onMove(index - 1);
        }}
      >
        {copy.upButton}
      </Button>
      <Button
        variant="outline"
        size="small"
        aria-label={copy.down(name)}
        disabled={index === count - 1}
        onClick={() => {
          onMove(index + 1);
        }}
      >
        {copy.downButton}
      </Button>
      <Button variant="outline" size="small" aria-label={copy.remove(name)} onClick={onRemove}>
        {copy.removeButton}
      </Button>
      {line.client !== null && props.clientLabel !== undefined && (
        <TextInput
          className={styles.client}
          id={`${id}-${line.key}-client`}
          maxLength={props.longest}
          aria-label={props.clientLabel(index + 1)}
          placeholder={copy.clientNone}
          value={line.client}
          onChange={(event) => {
            onClient(event.target.value);
          }}
        />
      )}
    </li>
  );
}

/** What a save sends: each item by its code where it has one, a checklist's with the client's words or none. */
const itemsSent = (lines: readonly Line[]): JobSheetItemSent[] =>
  lines.map((line) => {
    const words = line.code === null ? { label: line.label.trim() } : { code: line.code, label: line.label.trim() };
    if (line.client === null) return words;
    return { ...words, client: line.client.trim() === "" ? null : line.client.trim() };
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

export function ListEditor(props: Props) {
  const { id, title, list, most, longest } = props;
  const withClient = props.clientLabel !== undefined;
  const [lines, setLines] = useState<Line[]>(() => linesOf(list, withClient));
  const [saved, setSaved] = useState(false);
  const steps = useSteps(
    async () => sentOf(await props.send(itemsSent(lines)), (sheet) => ({ sheet })),
    (sent) => {
      // The new items have their codes now, so a second save names them rather than adding them again.
      setLines(linesOf(props.pick(sent.sheet), withClient));
      setSaved(true);
      steps.edit();
      props.onSaved(sent.sheet);
    },
  );
  const added = useRef(0);
  const change = (next: Line[]) => {
    setLines(next);
    setSaved(false);
    steps.edit();
  };
  const labels = lines.map((line) => line.label.trim().toLowerCase());
  const ready =
    lines.length > 0 &&
    lines.length <= most &&
    labels.every((label, index) => label !== "" && label.length <= longest && labels.indexOf(label) === index) &&
    lines.every((line) => (line.client?.trim().length ?? 0) <= longest);
  // What is off the list: retired before, or taken off in this draft, each able to go back on.
  const off = [...list.retired, ...list.items].filter((item) => !lines.some((line) => line.code === item.code));
  const changes = changesOf(list, lines);

  return (
    <SettingForm
      said={saved ? copy.saved : null}
      title={title}
      steps={steps}
      ready={ready}
      errors={{
        ...copy.errors,
        items: copy.limits.items(most),
        label: copy.limits.label(longest),
        client: copy.limits.client(longest),
      }}
      onCancel={null}
      sendable={changes.length > 0}
      above={
        <>
          <p className={form.set}>{setLineOf(list)}</p>
          {withClient && <p className={form.set}>{copy.clientNote}</p>}
        </>
      }
      checking={(changes.length === 0 ? [review.nothing] : changes).map((line) => (
        <p className={form.checkLine} key={line}>
          {line}
        </p>
      ))}
    >
      <ol className={styles.items}>
        {lines.map((line, index) => (
          <Item
            key={line.key}
            line={line}
            index={index}
            count={lines.length}
            id={id}
            props={props}
            onLabel={(label) => {
              change(lines.map((each) => (each.key === line.key ? { ...each, label } : each)));
            }}
            onClient={(client) => {
              change(lines.map((each) => (each.key === line.key ? { ...each, client } : each)));
            }}
            onMove={(to) => {
              const next = lines.filter((each) => each.key !== line.key);
              next.splice(to, 0, line);
              change(next);
            }}
            onRemove={() => {
              change(lines.filter((each) => each.key !== line.key));
            }}
          />
        ))}
      </ol>
      <FormActions>
        <Button
          variant="outline"
          size="small"
          className={form.quiet}
          disabled={lines.length >= most}
          onClick={() => {
            added.current += 1;
            const key = `new-${String(added.current)}`;
            change([...lines, { key, code: null, label: "", client: withClient ? "" : null }]);
          }}
        >
          {props.addLabel}
        </Button>
      </FormActions>
      {off.length > 0 && (
        <Removed
          off={off}
          full={lines.length >= most}
          onPutBack={(item) => {
            change([...lines, lineOf(item, withClient)]);
          }}
        />
      )}
    </SettingForm>
  );
}

/** What is off the list, each able to go back on while there is room. */
function Removed(props: { off: readonly ListItem[]; full: boolean; onPutBack: (item: ListItem) => void }) {
  return (
    <div className={styles.retired}>
      <p className={styles.retiredTitle}>{copy.retired}</p>
      <ul className={styles.retiredList}>
        {props.off.map((item) => (
          <li className={styles.retiredItem} key={item.code}>
            <span>{item.label}</span>
            <Button
              variant="outline"
              size="small"
              aria-label={copy.putBack(item.label)}
              disabled={props.full}
              onClick={() => {
                props.onPutBack(item);
              }}
            >
              {copy.putBackButton}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
