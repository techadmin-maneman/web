// One list of the job sheet as ops edit it: a checklist or the partial reasons
// (docs/decisions/0087-consumables-and-stock.md). Items are renamed, moved, taken off or put back, each keeping its
// code, so a phone holding the old list still sends what the API understands. The check shows what changes first (ADR
// 0071).

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

/** An item as it is edited: a new one has no code yet, and every one a key React can follow as it moves. */
interface Line {
  readonly key: string;
  readonly code: string | null;
  readonly label: string;
}

const linesOf = (list: JobSheetList): Line[] =>
  list.items.map((item) => ({ key: item.code, code: item.code, label: item.label }));

/** What the change is: each item added, renamed or taken off, and whether the order moves. */
function changesOf(list: JobSheetList, lines: readonly Line[]): string[] {
  const { confirm } = copy;
  const was = new Map(list.items.map((item) => [item.code, item.label]));
  const kept = new Set(lines.flatMap((line) => (line.code === null ? [] : [line.code])));
  const changes = [
    ...lines.flatMap((line) => {
      const before = line.code === null ? undefined : was.get(line.code);
      if (before === undefined) return [confirm.added(line.label.trim())];
      return before === line.label.trim() ? [] : [confirm.renamed(before, line.label.trim())];
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
  readonly list: JobSheetList;
  readonly most: number;
  readonly longest: number;
  readonly itemLabel: (position: number) => string;
  readonly addLabel: string;
  /** The list's write, which the form's steps send once its change is confirmed. */
  readonly send: (items: JobSheetItemSent[]) => Promise<Answer<JobSheet>>;
  /** This list, out of the sheet the save answers with. */
  readonly pick: (sheet: JobSheet) => JobSheetList;
  readonly onSaved: (sheet: JobSheet) => void;
}

function Item({
  line,
  index,
  count,
  id,
  props,
  onLabel,
  onMove,
  onRemove,
}: {
  line: Line;
  index: number;
  count: number;
  id: string;
  props: Props;
  onLabel: (label: string) => void;
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
    </li>
  );
}

const setLineOf = (list: JobSheetList): string =>
  list.set_by === null || list.set_at === null
    ? copy.committed
    : copy.setBy(whoWords(list.set_by), longDate(list.set_at));

/** The list as a person whose access does not let them change it reads it: its items, in their order. */
export function ListRead({ title, list }: { title: string; list: JobSheetList }) {
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
  const [lines, setLines] = useState<Line[]>(() => linesOf(list));
  const [saved, setSaved] = useState(false);
  const steps = useSteps(
    async () =>
      sentOf(
        await props.send(
          lines.map((line) =>
            line.code === null ? { label: line.label.trim() } : { code: line.code, label: line.label.trim() },
          ),
        ),
        (sheet) => ({ sheet }),
      ),
    (sent) => {
      // The new items have their codes now, so a second save names them rather than adding them again.
      setLines(linesOf(props.pick(sent.sheet)));
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
    labels.every((label, index) => label !== "" && label.length <= longest && labels.indexOf(label) === index);
  // What is off the list: retired before, or taken off in this draft, each able to go back on.
  const off = [...list.retired, ...list.items].filter((item) => !lines.some((line) => line.code === item.code));
  const changes = changesOf(list, lines);

  return (
    <SettingForm
      said={saved ? copy.saved : null}
      title={title}
      steps={steps}
      ready={ready}
      errors={{ ...copy.errors, items: copy.limits.items(most), label: copy.limits.label(longest) }}
      onCancel={null}
      sendable={changes.length > 0}
      above={<p className={form.set}>{setLineOf(list)}</p>}
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
            change([...lines, { key: `new-${String(added.current)}`, code: null, label: "" }]);
          }}
        >
          {props.addLabel}
        </Button>
      </FormActions>
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
                  disabled={lines.length >= most}
                  onClick={() => {
                    change([...lines, { key: item.code, code: item.code, label: item.label }]);
                  }}
                >
                  {copy.putBackButton}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingForm>
  );
}
