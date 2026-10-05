// One list of the job sheet as ops edit it: a kind of visit's checklist, or
// the partial reasons (docs/decisions/0087-consumables-and-stock.md). Its items
// in their order, each renamed in its box, moved, or taken off; one added at
// the foot; one taken off put back. An item keeps its code through all of it,
// so a phone that holds the list as it was still sends what the API
// understands. The check shows what is added, renamed and taken off before
// anything is sent (ADR 0071).

import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { longDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import type { Answer, JobSheet, JobSheetItemSent, JobSheetList } from "../api.ts";
import { settings } from "../content.ts";
import { whoWords } from "../lib/who.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import own from "./consumables.module.css";
import styles from "../components/forms.module.css";

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

type Step = { readonly step: "editing" | "checking" | "saving" | "saved" } | ({ readonly step: "failed" } & Failure);

interface Props {
  readonly id: string;
  readonly title: string;
  readonly list: JobSheetList;
  readonly most: number;
  readonly longest: number;
  readonly itemLabel: (position: number) => string;
  readonly addLabel: string;
  readonly onSave: (items: JobSheetItemSent[]) => Promise<Answer<JobSheet>>;
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
    <li className={own.item}>
      <input
        className={own.label}
        id={`${id}-${line.key}`}
        type="text"
        maxLength={props.longest}
        aria-label={props.itemLabel(index + 1)}
        aria-describedby={`${id}-hint`}
        value={line.label}
        onChange={(event) => {
          onLabel(event.target.value);
        }}
      />
      <button
        className={own.move}
        type="button"
        aria-label={copy.up(name)}
        disabled={index === 0}
        onClick={() => {
          onMove(index - 1);
        }}
      >
        {copy.upButton}
      </button>
      <button
        className={own.move}
        type="button"
        aria-label={copy.down(name)}
        disabled={index === count - 1}
        onClick={() => {
          onMove(index + 1);
        }}
      >
        {copy.downButton}
      </button>
      <button className={own.move} type="button" aria-label={copy.remove(name)} onClick={onRemove}>
        {copy.removeButton}
      </button>
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
    <div className={styles.group}>
      <h3 className={styles.ruleTitle}>{title}</h3>
      <p className={styles.set}>{setLineOf(list)}</p>
      <ol className={own.items}>
        {list.items.map((item) => (
          <li className={own.item} key={item.code}>
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
  const [step, setStep] = useState<Step>({ step: "editing" });
  const added = useRef(0);
  const change = (next: Line[]) => {
    setLines(next);
    setStep({ step: "editing" });
  };
  const labels = lines.map((line) => line.label.trim().toLowerCase());
  const ready =
    lines.length > 0 &&
    lines.length <= most &&
    labels.every((label, index) => label !== "" && label.length <= longest && labels.indexOf(label) === index);
  // What is off the list: retired before, or taken off in this draft, each able to go back on.
  const off = [...list.retired, ...list.items].filter((item) => !lines.some((line) => line.code === item.code));
  const changes = changesOf(list, lines);
  const checking = step.step === "checking" || step.step === "saving";

  const send = async () => {
    setStep({ step: "saving" });
    const answer = await props.onSave(
      lines.map((line) =>
        line.code === null ? { label: line.label.trim() } : { code: line.code, label: line.label.trim() },
      ),
    );
    if (!answer.ok) {
      setStep({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    // The new items have their codes now, so a second save names them rather than adding them again.
    setLines(linesOf(props.pick(answer.body)));
    props.onSaved(answer.body);
    setStep({ step: "saved" });
  };

  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{title}</legend>
      <p className={styles.set}>{setLineOf(list)}</p>
      <ol className={own.items}>
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
      <p className={styles.hint} id={`${id}-hint`}>
        {copy.hint(most, longest)}
      </p>
      <div className={styles.actions}>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          disabled={lines.length >= most}
          onClick={() => {
            added.current += 1;
            change([...lines, { key: `new-${String(added.current)}`, code: null, label: "" }]);
          }}
        >
          {props.addLabel}
        </Button>
      </div>
      {off.length > 0 && (
        <div className={own.retired}>
          <p className={own.retiredTitle}>{copy.retired}</p>
          <p className={styles.hint}>{copy.retiredNote}</p>
          <ul className={own.retiredList}>
            {off.map((item) => (
              <li className={own.retiredItem} key={item.code}>
                <span>{item.label}</span>
                <button
                  className={own.move}
                  type="button"
                  aria-label={copy.putBack(item.label)}
                  disabled={lines.length >= most}
                  onClick={() => {
                    change([...lines, { key: item.code, code: item.code, label: item.label }]);
                  }}
                >
                  {copy.putBackButton}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {checking && (
        <CheckPanel
          title={copy.confirm.title}
          lines={changes.length === 0 ? [copy.confirm.nothing] : changes}
          send={copy.confirm.send}
          sending={copy.saving}
          back={copy.confirm.back}
          busy={step.step === "saving"}
          ready={changes.length > 0}
          onSend={() => void send()}
          onBack={() => {
            setStep({ step: "editing" });
          }}
        />
      )}
      {!checking && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            disabled={!ready}
            onClick={() => {
              setStep({ step: "checking" });
            }}
          >
            {copy.save}
          </Button>
        </div>
      )}
      {step.step === "saved" && (
        <p className={styles.saved} role="status">
          {copy.saved}
        </p>
      )}
      {step.step === "failed" && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, step)}
        </p>
      )}
    </fieldset>
  );
}
