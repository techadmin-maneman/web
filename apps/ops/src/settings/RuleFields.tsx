// A rule's rows in a Settings page of policies (./Rules.tsx), one figure or one choice a row: a figure with its unit,
// and the range it may take said only once what is typed falls outside it; a choice from those its key may take; an
// open-keyed rule's new key; and, for a person who may only look, each value as it reads, with no box.

import { Button } from "@maneman/ui/Button";
import { NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { SettingRow, SettingValue } from "@maneman/ui/SettingRow";
import { useState } from "react";
import { type ChoiceRule, type NumberRule, type OpsSetting } from "../api.ts";
import { settings } from "../content/settings.ts";
import { FormActions } from "../components/FormActions.tsx";
import { keyLabel, boundsOf, choiceLabel, rangeWords, whole, READ_AS, type Draft } from "./rule-drafts.ts";

const copy = settings.rules;

/** A figure's unit: the unit itself, or for an hour or a day of the week, the figure read in words. */
function unitOf(unit: string, text: string, fits: boolean): string {
  const reading = READ_AS[unit];
  if (reading === undefined) return unit;
  return fits ? reading.say(Number(text)) : "";
}

function FigureRow({
  id,
  label,
  bounds,
  text,
  onChange,
}: {
  id: string | undefined;
  label: string;
  bounds: { min: number; max: number; unit: string };
  text: string;
  onChange: (text: string) => void;
}) {
  const fits = whole(text, bounds.min, bounds.max);
  // A figure outside the bounds is not a change the page can send, so the row says why.
  const outside = text.trim() !== "" && !fits;
  return (
    <SettingRow
      id={id}
      label={label}
      unit={unitOf(bounds.unit, text, fits)}
      error={outside ? rangeWords(bounds) : null}
    >
      {(control) => (
        <NumberInput
          {...control}
          width="figure"
          inputMode="numeric"
          step={1}
          min={bounds.min}
          max={bounds.max}
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </SettingRow>
  );
}

function ChoiceRow({
  label,
  rule,
  choices,
  choice,
  onChange,
}: {
  label: string;
  rule: ChoiceRule;
  choices: readonly string[];
  choice: string;
  onChange: (choice: string) => void;
}) {
  return (
    <SettingRow label={label}>
      {(control) => (
        <Select
          {...control}
          width="choice"
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
        </Select>
      )}
    </SettingRow>
  );
}

/** The extra pair an open-keyed rule needs, a row each: a base, and its own cycle. */
export function AddKey({ rule, onAdd }: { rule: NumberRule; onAdd: (key: string, text: string) => void }) {
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const ready = key.trim() !== "" && whole(text, rule.min, rule.max);
  return (
    <>
      <SettingRow label={copy.keyName}>
        {(control) => (
          <TextInput
            {...control}
            width="area"
            maxLength={64}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
            }}
          />
        )}
      </SettingRow>
      <SettingRow label={copy.keyValue} unit={rule.unit}>
        {(control) => (
          <NumberInput
            {...control}
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
        )}
      </SettingRow>
      <FormActions>
        <Button
          variant="outline"
          size="small"
          narrow
          disabled={!ready}
          onClick={() => {
            onAdd(key.trim(), text);
            setKey("");
            setText("");
          }}
        >
          {copy.add}
        </Button>
      </FormActions>
    </>
  );
}

/** A rule's rows: a figure's or a choice's a row; the first row of a rule of one figure carries its anchor. */
export function Fields({
  rule,
  draft,
  onChange,
}: {
  rule: OpsSetting;
  draft: Draft;
  onChange: (key: string, text: string) => void;
}) {
  if (rule.kind === "choice") {
    return rule.keys.map((key) => (
      <ChoiceRow
        key={key}
        label={keyLabel(rule, key)}
        rule={rule}
        choices={rule.choices[key] ?? []}
        choice={draft[key] ?? ""}
        onChange={(choice) => {
          onChange(key, choice);
        }}
      />
    ));
  }
  const single = typeof rule.value === "number";
  return Object.entries(draft).map(([key, text]) => (
    <FigureRow
      key={key}
      id={single ? rule.name : undefined}
      label={single ? rule.title : keyLabel(rule, key)}
      bounds={boundsOf(rule, key)}
      text={text}
      onChange={(next) => {
        onChange(key, next);
      }}
    />
  ));
}

/** A rule's values as they read, a row each, for a person who may only look. */
export function Values({ rule }: { rule: OpsSetting }) {
  if (typeof rule.value === "number" && rule.kind === "number") {
    const bounds = boundsOf(rule, rule.name);
    return <SettingValue id={rule.name} label={rule.title} value={valueWords(rule.value, bounds.unit)} />;
  }
  return Object.entries(rule.value).map(([key, value]) => (
    <SettingValue
      key={key}
      label={keyLabel(rule, key)}
      value={
        rule.kind === "choice" ? choiceLabel(rule, String(value)) : valueWords(Number(value), boundsOf(rule, key).unit)
      }
    />
  ));
}

/** "200 metres", "6 pm", "Monday". */
function valueWords(figure: number, unit: string): string {
  return READ_AS[unit]?.say(figure) ?? copy.confirm.figure(figure, unit);
}
