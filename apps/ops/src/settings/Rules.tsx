// The rules ops set for themselves: the check-in radius, the no-show wait,
// when a job's address unlocks, how long a task may wait, and the replacement
// cycle per base (docs/decisions/0061-ops-editable-inputs.md).
//
// Every field says its unit and its bounds before anything is typed, and a
// refusal names the box it came from, which the API gives as the rule's name
// or as "rule.key". A draft is held as text, never as a number: an empty box
// would read as nought, and a nought here is a radius no arrival can pass or a
// cycle due the day it is fitted.

import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type OpsSetting, type SettingValue } from "../api.ts";
import { settings } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./settings.module.css";

const copy = settings.rules;

/** How a rule's form is going. */
type Saving =
  | { readonly step: "editing" | "saving" | "saved" }
  | { readonly step: "failed"; readonly code: string; readonly fields: readonly string[] };

/** A rule's draft: the text in each box, keyed as the value is. One number uses the rule's own name. */
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

const draftOf = (rule: OpsSetting): Draft =>
  typeof rule.value === "number"
    ? { [rule.name]: String(rule.value) }
    : Object.fromEntries(Object.entries(rule.value).map(([key, each]) => [key, String(each)]));

const whole = (text: string, min: number, max: number): boolean => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max;
};

const valueOf = (rule: OpsSetting, draft: Draft): SettingValue =>
  typeof rule.value === "number"
    ? Number(draft[rule.name])
    : Object.fromEntries(Object.entries(draft).map(([key, text]) => [key, Number(text)]));

function Field({
  id,
  label,
  rule,
  text,
  onChange,
}: {
  id: string;
  label: string;
  rule: OpsSetting;
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
          min={rule.min}
          max={rule.max}
          value={text}
          aria-describedby={hint}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <span className={styles.unit}>{rule.unit}</span>
      </div>
      <p className={styles.hint} id={hint}>
        {copy.allowed(rule.min, rule.max, rule.unit)}
      </p>
    </div>
  );
}

/** The extra pair an open-keyed rule needs: a base FSM names, and its own cycle. */
function AddKey({ rule, onAdd }: { rule: OpsSetting; onAdd: (key: string, text: string) => void }) {
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
      <button
        className={styles.quiet}
        type="button"
        disabled={!ready}
        onClick={() => {
          onAdd(key.trim(), text);
          setKey("");
          setText("");
        }}
      >
        {copy.add}
      </button>
    </div>
  );
}

/** Who set a rule and when, or that nobody has. */
function setLine(rule: OpsSetting): string {
  if (rule.set_by === null || rule.set_at === null) return copy.committed;
  return copy.setBy(rule.set_by, longDate(rule.set_at));
}

function Rule({ rule, onSaved }: { rule: OpsSetting; onSaved: (saved: OpsSetting) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(rule));
  const [saving, setSaving] = useState<Saving>({ step: "editing" });

  const complete = Object.values(draft).every((text) => whole(text, rule.min, rule.max));
  const busy = saving.step === "saving";

  const send = async (value: SettingValue | null) => {
    setSaving({ step: "saving" });
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
      <fieldset className={styles.group}>
        <legend className={styles.ruleTitle}>{rule.title}</legend>
        <p className={styles.note}>{rule.note}</p>
        <div className={styles.fields}>
          {Object.entries(draft).map(([key, text]) => (
            <Field
              key={key}
              id={`${rule.name}-${key}`}
              label={typeof rule.value === "number" ? rule.title : keyLabel(rule, key)}
              rule={rule}
              text={text}
              onChange={(next) => {
                setDraft({ ...draft, [key]: next });
                setSaving({ step: "editing" });
              }}
            />
          ))}
        </div>
        {rule.keys === "open" && (
          <AddKey
            rule={rule}
            onAdd={(key, text) => {
              setDraft({ ...draft, [key]: text });
              setSaving({ step: "editing" });
            }}
          />
        )}
      </fieldset>

      <p className={styles.set}>{setLine(rule)}</p>
      <div className={styles.actions}>
        <button
          className={styles.save}
          type="button"
          disabled={busy || !complete}
          onClick={() => void send(valueOf(rule, draft))}
        >
          {busy ? copy.saving : copy.save}
        </button>
        {rule.set_by !== null && (
          <button className={styles.quiet} type="button" disabled={busy} onClick={() => void send(null)}>
            {copy.reset}
          </button>
        )}
      </div>
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
