// A rule's rows in a Settings page of policies (./Rules.tsx), one figure or one choice a row, each changed where it
// reads (docs/decisions/0212-editing-in-place.md): a figure with its unit, refused with the range it may take; a choice
// from those its key may take; an open-keyed rule's new key; and, for a person who may only look, each value as it
// reads, with nothing to press. A row saves its own figure, the rule's others as they stand.

import { Button } from "@maneman/ui/Button";
import { EditableRow } from "@maneman/ui/EditableRow";
import { NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import type { ChoiceRule, NumberRule, OpsSetting, SettingValue } from "../api.ts";
import { Refusal } from "../components/Refusal.tsx";
import { EDITING } from "../content/common.ts";
import { settings } from "../content/settings.ts";
import { boundsOf, choiceLabel, keyLabel, rangeWords, READ_AS, ruleRefusal, whole } from "./rule-drafts.ts";
import { settingsApi } from "./settings-api.ts";
import styles from "./rules.module.css";

const copy = settings.rules;

/** Sends a rule's whole value, or null to put its standard back: null once kept, else the words of why not. */
export async function saveRule(
  rule: OpsSetting,
  value: SettingValue | null,
  onSaved: (saved: OpsSetting) => void,
): Promise<string | null> {
  const answer = await settingsApi.setSetting(rule.name, value);
  if (!answer.ok) return ruleRefusal(rule, answer.code, answer.fields) ?? copy.errors.unknown;
  onSaved(answer.body);
  return null;
}

/** "200 metres", "6 pm", "Monday". */
function valueWords(figure: number, unit: string): string {
  return READ_AS[unit]?.say(figure) ?? copy.confirm.figure(figure, unit);
}

interface RowProps {
  readonly rule: OpsSetting;
  readonly mayChange: boolean;
  readonly onSaved: (saved: OpsSetting) => void;
}

/** One figure: the rule's only one, under its own name, or one of its keys. */
function FigureRow({ rule, figureKey, mayChange, onSaved }: RowProps & { readonly figureKey: string }) {
  if (rule.kind !== "number") return null;
  const single = typeof rule.value === "number";
  const bounds = boundsOf(rule, figureKey);
  const current = typeof rule.value === "number" ? rule.value : (rule.value[figureKey] ?? 0);
  const valueWith = (figure: number): SettingValue =>
    typeof rule.value === "number" ? figure : { ...rule.value, [figureKey]: figure };
  return (
    <EditableRow<string>
      id={single ? rule.name : undefined}
      label={single ? rule.title : keyLabel(rule, figureKey)}
      words={EDITING}
      mayChange={mayChange}
      value={valueWords(current, bounds.unit)}
      unit={READ_AS[bounds.unit] === undefined ? bounds.unit : undefined}
      start={() => String(current)}
      save={(typed) =>
        whole(typed, bounds.min, bounds.max)
          ? saveRule(rule, valueWith(Number(typed)), onSaved)
          : Promise.resolve(rangeWords(bounds))
      }
    >
      {(control, typed, type) => (
        <NumberInput
          {...control}
          width="figure"
          inputMode="numeric"
          step={1}
          min={bounds.min}
          max={bounds.max}
          value={typed}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      )}
    </EditableRow>
  );
}

/** One choice of a rule with a choice a key. */
function ChoiceRow({
  rule,
  choiceKey,
  mayChange,
  onSaved,
}: RowProps & { readonly rule: ChoiceRule; readonly choiceKey: string }) {
  const current = rule.value[choiceKey] ?? "";
  return (
    <EditableRow<string>
      label={keyLabel(rule, choiceKey)}
      words={EDITING}
      mayChange={mayChange}
      value={choiceLabel(rule, current)}
      start={() => current}
      save={(chosen) => saveRule(rule, { ...rule.value, [choiceKey]: chosen }, onSaved)}
    >
      {(control, chosen, choose) => (
        <Select
          {...control}
          width="choice"
          value={chosen}
          onChange={(event) => {
            choose(event.target.value);
          }}
        >
          {(rule.choices[choiceKey] ?? []).map((each) => (
            <option key={each} value={each}>
              {choiceLabel(rule, each)}
            </option>
          ))}
        </Select>
      )}
    </EditableRow>
  );
}

/** An open-keyed rule's new key and its figure, saved with the rest as they stand. */
function AddKey({ rule, onSaved }: { readonly rule: NumberRule; readonly onSaved: (saved: OpsSetting) => void }) {
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const add = () =>
    once(async () => {
      if (key.trim() === "" || !whole(text, rule.min, rule.max)) {
        setRefused(rangeWords(boundsOf(rule, rule.name)));
        return;
      }
      const value = typeof rule.value === "number" ? rule.value : { ...rule.value, [key.trim()]: Number(text) };
      const why = await saveRule(rule, value, onSaved);
      setRefused(why);
      if (why === null) {
        setKey("");
        setText("");
      }
    });
  return (
    <form
      noValidate
      className={styles.addKey}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <TextInput
        aria-label={copy.keyName}
        placeholder={copy.keyName}
        width="area"
        maxLength={64}
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
        }}
      />
      <NumberInput
        aria-label={copy.keyValue}
        width="figure"
        inputMode="numeric"
        step={1}
        min={rule.min}
        max={rule.max}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <Button variant="outline" size="small" type="submit" busy={busy}>
        {copy.add}
      </Button>
      {refused !== null && <Refusal className={styles.refusal} said={refused} />}
    </form>
  );
}

/** A rule's rows: a figure's or a choice's a row, and an open-keyed rule's way to name another key. */
export function RuleRows({ rule, mayChange, onSaved }: RowProps) {
  if (rule.kind === "choice") {
    return rule.keys.map((key) => (
      <ChoiceRow key={key} rule={rule} choiceKey={key} mayChange={mayChange} onSaved={onSaved} />
    ));
  }
  const keys = typeof rule.value === "number" ? [rule.name] : Object.keys(rule.value);
  return (
    <>
      {keys.map((key) => (
        <FigureRow key={key} rule={rule} figureKey={key} mayChange={mayChange} onSaved={onSaved} />
      ))}
      {mayChange && rule.keys === "open" && <AddKey rule={rule} onSaved={onSaved} />}
    </>
  );
}
