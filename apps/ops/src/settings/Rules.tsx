// The rules ops set for themselves: the check-in radius, the no-show wait,
// when a job's address unlocks, how long a task may wait, the replacement
// cycle per base (docs/decisions/0061-ops-editable-inputs.md), the days the
// next visit turns on (docs/decisions/0086-the-next-visit-is-offered.md), and
// every other policy the code held (docs/decisions/0088-every-policy-in-the-console.md).
//
// A rule is numbers or choices. Every number says its unit and its bounds
// before anything is typed, each box its own where a rule's figures differ, and
// a refusal names the box it came from, which the API gives as the rule's name
// or as "rule.key". A draft is held as text, never as a number: an empty box
// would read as nought, and a nought here is a radius no arrival can pass or a
// cycle due the day it is fitted. A choice is picked from those its key may
// take, each in the console's words.
//
// Nothing is sent until ops have seen the change: each figure that moves, the
// old beside the new, and only the second press sends it, as a price is set
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState } from "react";
import { api, type ChoiceRule, type NumberRule, type OpsSetting, type SettingValue } from "../api.ts";
import { settings } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./settings.module.css";

const copy = settings.rules;

/**
 * How a rule's form is going. While ops check a change, `value` is what would be sent: the figures typed, or null
 * to go back to the standard figure.
 */
type Saving =
  | { readonly step: "editing" | "saved" }
  | { readonly step: "checking" | "saving"; readonly value: SettingValue | null }
  | { readonly step: "failed"; readonly code: string; readonly fields: readonly string[] };

/** A rule's draft: the text in each box, or the choice, keyed as the value is. One number uses the rule's own name. */
type Draft = Readonly<Record<string, string>>;

function keyLabel(rule: OpsSetting, key: string): string {
  if (key === "default") return copy.defaultKey;
  return copy.keyNames[rule.name]?.[key] ?? key;
}

/** The box a refusal names: "no_show_wait_min.first_fit" is First fit, and the rule's own name the rule. */
function fieldLabel(rule: OpsSetting, field: string): string {
  const [, key] = field.split(".");
  return key === undefined ? rule.title : keyLabel(rule, key);
}

function refusalOf(rule: OpsSetting, code: string, fields: readonly string[]): string | undefined {
  const [field] = fields;
  if (code !== "invalid_request") return copy.errors[code] ?? copy.errors.unknown;
  if (field === undefined) return copy.errors.invalid_request;
  return copy.outside(fieldLabel(rule, field));
}

/** What one box may hold, and what it counts: its key's own where the rule gives them, else the rule's. */
function boundsOf(rule: NumberRule, key: string): { min: number; max: number; unit: string } {
  return rule.bounds?.[key] ?? { min: rule.min, max: rule.max, unit: rule.unit };
}

const choiceLabel = (rule: ChoiceRule, choice: string): string => copy.choiceNames[rule.name]?.[choice] ?? choice;

const draftOf = (rule: OpsSetting): Draft =>
  typeof rule.value === "number"
    ? { [rule.name]: String(rule.value) }
    : Object.fromEntries(Object.entries(rule.value).map(([key, each]) => [key, String(each)]));

const whole = (text: string, min: number, max: number): boolean => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max;
};

/** Whether every box holds what its key may take, so the draft can be sent. */
function isComplete(rule: OpsSetting, draft: Draft): boolean {
  if (rule.kind === "choice") {
    return Object.entries(draft).every(([key, choice]) => rule.choices[key]?.includes(choice) === true);
  }
  return Object.entries(draft).every(([key, text]) => {
    const { min, max } = boundsOf(rule, key);
    return whole(text, min, max);
  });
}

function valueOf(rule: OpsSetting, draft: Draft): SettingValue {
  if (rule.kind === "choice") return draft;
  return typeof rule.value === "number"
    ? Number(draft[rule.name])
    : Object.fromEntries(Object.entries(draft).map(([key, text]) => [key, Number(text)]));
}

/** One figure a change moves: its box, and what it reads as now and would read as after, in the console's words. */
interface Moved {
  readonly key: string;
  readonly label: string;
  readonly was: string;
  readonly now: string;
}

/** A number as the check reads it, with its unit. Null before is a base not yet named; null after, one unnamed. */
function numberWords(rule: NumberRule, key: string, figure: number | undefined, side: "was" | "now"): string {
  if (figure !== undefined) return copy.confirm.figure(figure, boundsOf(rule, key).unit);
  return side === "was" ? copy.confirm.noFigure : copy.confirm.otherBases;
}

/** Each figure `next` would change, in the order the boxes are shown. */
function movedBy(rule: OpsSetting, next: SettingValue): Moved[] {
  if (rule.kind === "choice") {
    const now = next as Readonly<Record<string, string>>;
    return rule.keys
      .filter((key) => rule.value[key] !== now[key])
      .map((key) => ({
        key,
        label: keyLabel(rule, key),
        was: choiceLabel(rule, rule.value[key] ?? ""),
        now: choiceLabel(rule, now[key] ?? ""),
      }));
  }
  if (typeof rule.value === "number" || typeof next === "number") {
    const was = typeof rule.value === "number" ? rule.value : undefined;
    const now = typeof next === "number" ? next : undefined;
    if (now === undefined || was === now) return [];
    const words = (figure: number | undefined, side: "was" | "now") => numberWords(rule, rule.name, figure, side);
    return [{ key: rule.name, label: rule.title, was: words(was, "was"), now: words(now, "now") }];
  }
  const current = rule.value;
  const after = next as Readonly<Record<string, number>>;
  const keys = [...new Set([...Object.keys(current), ...Object.keys(after)])];
  return keys
    .filter((key) => current[key] !== after[key])
    .map((key) => ({
      key,
      label: keyLabel(rule, key),
      was: numberWords(rule, key, current[key], "was"),
      now: numberWords(rule, key, after[key], "now"),
    }));
}

function Field({
  id,
  label,
  bounds,
  text,
  onChange,
}: {
  id: string;
  label: string;
  bounds: { min: number; max: number; unit: string };
  text: string;
  onChange: (text: string) => void;
}) {
  const hint = `${id}-allowed`;
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <div className={styles.fieldRow}>
        <input
          className={styles.number}
          id={id}
          type="number"
          inputMode="numeric"
          step={1}
          min={bounds.min}
          max={bounds.max}
          value={text}
          aria-describedby={hint}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <span className={styles.unit}>{bounds.unit}</span>
      </div>
      <p className={styles.hint} id={hint}>
        {copy.allowed(bounds.min, bounds.max, bounds.unit)}
      </p>
    </div>
  );
}

function ChoiceField({
  id,
  label,
  rule,
  choices,
  choice,
  onChange,
}: {
  id: string;
  label: string;
  rule: ChoiceRule;
  choices: readonly string[];
  choice: string;
  onChange: (choice: string) => void;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <select
        className={styles.select}
        id={id}
        value={choice}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {choices.map((each) => (
          <option key={each} value={each}>
            {choiceLabel(rule, each)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The extra pair an open-keyed rule needs: a base FSM names, and its own cycle. */
function AddKey({ rule, onAdd }: { rule: NumberRule; onAdd: (key: string, text: string) => void }) {
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const ready = key.trim() !== "" && whole(text, rule.min, rule.max);
  return (
    <div className={styles.addKey}>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${rule.name}-new-key`}>
          {copy.keyName}
        </label>
        <input
          className={styles.text}
          id={`${rule.name}-new-key`}
          type="text"
          maxLength={64}
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
          }}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${rule.name}-new-value`}>
          {copy.keyValue}
        </label>
        <input
          className={styles.number}
          id={`${rule.name}-new-value`}
          type="number"
          inputMode="numeric"
          step={1}
          min={rule.min}
          max={rule.max}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>
      <Button
        variant="outline"
        size="small"
        className={styles.quiet}
        disabled={!ready}
        onClick={() => {
          onAdd(key.trim(), text);
          setKey("");
          setText("");
        }}
      >
        {copy.add}
      </Button>
    </div>
  );
}

/** Who set a rule and when, or that nobody has. */
function setLine(rule: OpsSetting): string {
  if (rule.set_by === null || rule.set_at === null) return copy.committed;
  return copy.setBy(rule.set_by, longDate(rule.set_at));
}

/** The old figure beside the new, for every one the change moves, before anything is sent. */
function Check({
  rule,
  value,
  busy,
  onSend,
  onBack,
}: {
  rule: OpsSetting;
  /** What would be sent: the figures typed, or null to go back to the standard figure. */
  value: SettingValue | null;
  busy: boolean;
  onSend: () => void;
  onBack: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const moved = movedBy(rule, value ?? rule.default);
  const title = `${rule.name}-check`;
  return (
    <div className={styles.check} ref={panel} tabIndex={-1} role="group" aria-labelledby={title}>
      <p className={styles.checkTitle} id={title}>
        {copy.confirm.title}
      </p>
      {value === null && <p className={styles.checkLine}>{copy.confirm.standard}</p>}
      <ul className={styles.checkList}>
        {moved.map((each) => (
          <li key={each.key}>{copy.confirm.change(each.label, each.was, each.now)}</li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.save} disabled={busy} onClick={onSend}>
          {busy ? copy.saving : copy.confirm.send}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={busy} onClick={onBack}>
          {copy.confirm.back}
        </Button>
      </div>
    </div>
  );
}

/** A rule's boxes: a number's with its unit and bounds, or a choice's from those its key may take. */
function Fields({
  rule,
  draft,
  onChange,
}: {
  rule: OpsSetting;
  draft: Draft;
  onChange: (key: string, text: string) => void;
}) {
  if (rule.kind === "choice") {
    return (
      <div className={styles.fields}>
        {rule.keys.map((key) => (
          <ChoiceField
            key={key}
            id={`${rule.name}-${key}`}
            label={keyLabel(rule, key)}
            rule={rule}
            choices={rule.choices[key] ?? []}
            choice={draft[key] ?? ""}
            onChange={(choice) => {
              onChange(key, choice);
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.fields}>
      {Object.entries(draft).map(([key, text]) => (
        <Field
          key={key}
          id={`${rule.name}-${key}`}
          label={typeof rule.value === "number" ? rule.title : keyLabel(rule, key)}
          bounds={boundsOf(rule, key)}
          text={text}
          onChange={(next) => {
            onChange(key, next);
          }}
        />
      ))}
    </div>
  );
}

function Rule({ rule, onSaved }: { rule: OpsSetting; onSaved: (saved: OpsSetting) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(rule));
  const [saving, setSaving] = useState<Saving>({ step: "editing" });

  // A figure that would not move is not a change: the log never records one that was not (ADR 0061).
  const changed = isComplete(rule, draft) && movedBy(rule, valueOf(rule, draft)).length > 0;
  const checking = saving.step === "checking" || saving.step === "saving";
  const busy = saving.step === "saving";
  const edit = (key: string, text: string) => {
    setDraft({ ...draft, [key]: text });
    setSaving({ step: "editing" });
  };

  const send = async (value: SettingValue | null) => {
    setSaving({ step: "saving", value });
    const answer = await api.setSetting(rule.name, value);
    if (!answer.ok) {
      setSaving({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    setDraft(draftOf(answer.body));
    setSaving({ step: "saved" });
    onSaved(answer.body);
  };

  return (
    <li className={styles.rule}>
      <fieldset className={styles.group} disabled={checking}>
        <legend className={styles.ruleTitle}>{rule.title}</legend>
        <p className={styles.note}>{rule.note}</p>
        <Fields rule={rule} draft={draft} onChange={edit} />
        {rule.kind === "number" && rule.keys === "open" && <AddKey rule={rule} onAdd={edit} />}
      </fieldset>

      <p className={styles.set}>{setLine(rule)}</p>
      {checking ? (
        <Check
          rule={rule}
          value={saving.value}
          busy={busy}
          onSend={() => void send(saving.value)}
          onBack={() => {
            setSaving({ step: "editing" });
          }}
        />
      ) : (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            className={styles.save}
            disabled={!changed}
            onClick={() => {
              setSaving({ step: "checking", value: valueOf(rule, draft) });
            }}
          >
            {copy.save}
          </Button>
          {rule.set_by !== null && (
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              onClick={() => {
                setSaving({ step: "checking", value: null });
              }}
            >
              {copy.reset}
            </Button>
          )}
        </div>
      )}
      {saving.step === "saved" && (
        <p className={styles.saved} role="status">
          {copy.saved}
        </p>
      )}
      {saving.step === "failed" && (
        <p className={styles.error} role="alert">
          {refusalOf(rule, saving.code, saving.fields)}
        </p>
      )}
    </li>
  );
}

export function Rules() {
  const [loaded, retry] = useLoad(api.settings);
  /** What each rule reads as now, so "Set by" follows a save without reading the whole list again. */
  const [saved, setSaved] = useState<Readonly<Record<string, OpsSetting>>>({});

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  return (
    <section className={styles.panel} aria-labelledby="rules">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="rules">
          {copy.title}
        </h2>
      </div>
      <ul className={styles.rules}>
        {loaded.value.settings.map((rule) => {
          const current = saved[rule.name] ?? rule;
          return (
            <Rule
              key={rule.name}
              rule={current}
              onSaved={(next) => {
                setSaved((already) => ({ ...already, [next.name]: next }));
              }}
            />
          );
        })}
      </ul>
    </section>
  );
}
