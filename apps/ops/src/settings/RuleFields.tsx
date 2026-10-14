// A rule's boxes in Settings › Rules (./Rules.tsx): a figure with its unit and bounds, a choice from those its key may
// take, a keyed rule's new key, and the boxes laid out, folded away past a handful.

import { Disclosure } from "@maneman/ui/Disclosure";
import { Field, NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { useState, type ReactNode } from "react";
import { type ChoiceRule, type NumberRule, type OpsSetting } from "../api.ts";
import { settings } from "../content/settings.ts";
import { keyLabel, boundsOf, choiceLabel, rangeWords, whole, READ_AS, type Draft } from "./rule-drafts.ts";
import form from "../components/forms.module.css";
import styles from "./rules.module.css";

const copy = settings.rules;

/** A rule's figure: its box and its unit, with the range it may take, or why what was typed is outside it. */
function FigureField({
  label,
  bounds,
  text,
  onChange,
}: {
  label: string;
  bounds: { min: number; max: number; unit: string };
  text: string;
  onChange: (text: string) => void;
}) {
  // An hour or a day of the week is read beside its box in words.
  const reading = READ_AS[bounds.unit];
  const fits = whole(text, bounds.min, bounds.max);
  let unit = bounds.unit;
  if (reading !== undefined) unit = fits ? reading.say(Number(text)) : "";
  // A figure outside the bounds is not a change Save can send, so the box says why rather than Save going grey.
  const outside = text.trim() !== "" && !fits;
  const why = rangeWords(bounds);
  return (
    <Field label={label} error={outside ? why : null} className={form.field}>
      {(control) => (
        <div className={form.fieldRow}>
          <NumberInput
            {...control}
            className={form.figureBox}
            inputMode="numeric"
            step={1}
            min={bounds.min}
            max={bounds.max}
            value={text}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
          <span className={form.unit}>{unit}</span>
        </div>
      )}
    </Field>
  );
}

function ChoiceField({
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
    <Field label={label} className={form.field}>
      {(control) => (
        <Select
          {...control}
          className={form.choiceBox}
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
    </Field>
  );
}

/** The extra pair an open-keyed rule needs: a base, and its own cycle. */
export function AddKey({ rule, onAdd }: { rule: NumberRule; onAdd: (key: string, text: string) => void }) {
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const ready = key.trim() !== "" && whole(text, rule.min, rule.max);
  return (
    <div className={styles.addKey}>
      <Field label={copy.keyName} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            className={form.text}
            maxLength={64}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.keyValue} className={form.field}>
        {(control) => (
          <NumberInput
            {...control}
            className={form.number}
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
      </Field>
      <Button
        variant="outline"
        size="small"
        className={form.quiet}
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

/** A rule's boxes: a number's with its unit and bounds, or a choice's from those its key may take. */
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
    return (
      <div className={form.fields}>
        {rule.keys.map((key) => (
          <ChoiceField
            key={key}
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
    <div className={form.fields}>
      {Object.entries(draft).map(([key, text]) => (
        <FigureField
          key={key}
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

/** A rule with more boxes than a row holds: shut until opened, so the page lists rules, not a wall of boxes. */
const MANY = 4;

export function Boxes({ rule, draft, children }: { rule: OpsSetting; draft: Draft; children: ReactNode }) {
  const count = rule.kind === "choice" ? rule.keys.length : Object.keys(draft).length;
  const open = rule.kind === "number" && rule.keys === "open";
  if (count <= MANY && !open) return <>{children}</>;
  return (
    <Disclosure className={styles.many} summaryClassName={styles.summary} summary={copy.showAll(count)}>
      <div className={styles.manyBody}>{children}</div>
    </Disclosure>
  );
}
