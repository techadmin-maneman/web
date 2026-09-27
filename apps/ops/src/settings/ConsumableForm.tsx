// Adding a consumable, or changing one: its name, its unit, what one costs and
// the levels a kit and the central store are low at
// (docs/decisions/0087-consumables-and-stock.md). The boxes start from what the
// consumable is now; the check shows each field that changes, old beside new,
// before anything is sent (ADR 0071). Every box holds text: an empty level is
// no level, never a nought.

import { Button } from "@maneman/ui/Button";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type Consumable, type Consumables } from "../api.ts";
import { settings } from "../content.ts";
import { CheckPanel } from "./CheckPanel.tsx";
import { refusalOf, type Failure } from "./refusal.ts";
import styles from "./settings.module.css";

const copy = settings.consumables;
const form = copy.form;

/** Rupees to the paisa, as typed: "12", "12.5", "12.50". */
const RUPEES = /^\d{1,7}(?:\.\d{1,2})?$/;
const WHOLE = /^\d{1,6}$/;

interface Draft {
  readonly name: string;
  readonly unit: string;
  readonly cost: string;
  readonly kit: string;
  readonly central: string;
}

const draftOf = (consumable: Consumable | null): Draft =>
  consumable === null
    ? { name: "", unit: "", cost: "", kit: "", central: "" }
    : {
        name: consumable.name,
        unit: consumable.unit,
        cost: String(consumable.unit_cost / 100),
        kit: consumable.reorder_kit === null ? "" : String(consumable.reorder_kit),
        central: consumable.reorder_central === null ? "" : String(consumable.reorder_central),
      };

const paiseOf = (text: string) => Math.round(Number(text) * 100);
const levelOf = (text: string) => (text.trim() === "" ? null : Number(text));
const levelWords = (level: number | null) => (level === null ? form.confirm.noLevel : String(level));

/** What the change is, field by field, each old beside new; empty when nothing changes. */
function changes(was: Consumable, draft: Draft): string[] {
  const { fields, line } = form.confirm;
  const lines: string[] = [];
  if (draft.name.trim() !== was.name) lines.push(line(fields.name, was.name, draft.name.trim()));
  if (draft.unit.trim() !== was.unit) lines.push(line(fields.unit, was.unit, draft.unit.trim()));
  if (paiseOf(draft.cost) !== was.unit_cost) {
    lines.push(line(fields.cost, rupees(was.unit_cost), rupees(paiseOf(draft.cost))));
  }
  if (levelOf(draft.kit) !== was.reorder_kit) {
    lines.push(line(fields.kit, levelWords(was.reorder_kit), levelWords(levelOf(draft.kit))));
  }
  if (levelOf(draft.central) !== was.reorder_central) {
    lines.push(line(fields.central, levelWords(was.reorder_central), levelWords(levelOf(draft.central))));
  }
  return lines;
}

type Step = { readonly step: "editing" | "checking" | "saving" } | ({ readonly step: "failed" } & Failure);

function Field(props: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  inputMode?: "decimal" | "numeric";
  maxLength: number;
  className: string | undefined;
  onChange: (text: string) => void;
}) {
  const hint = `${props.id}-hint`;
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={props.id}>
        {props.label}
      </label>
      <input
        className={props.className}
        id={props.id}
        type="text"
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        value={props.value}
        aria-describedby={props.hint === undefined ? undefined : hint}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      {props.hint !== undefined && (
        <p className={styles.hint} id={hint}>
          {props.hint}
        </p>
      )}
    </div>
  );
}

export function ConsumableForm({
  consumable,
  maxUnitCost,
  onSaved,
  onCancel,
}: {
  /** The one to change; null to add a new one. */
  consumable: Consumable | null;
  maxUnitCost: number;
  onSaved: (book: Consumables, said: string) => void;
  onCancel: (() => void) | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(consumable));
  const [step, setStep] = useState<Step>({ step: "editing" });
  const id = consumable === null ? "consumable-new" : `consumable-${consumable.code}`;
  const ready =
    draft.name.trim() !== "" &&
    draft.unit.trim() !== "" &&
    RUPEES.test(draft.cost.trim()) &&
    paiseOf(draft.cost) <= maxUnitCost &&
    [draft.kit, draft.central].every((level) => level.trim() === "" || WHOLE.test(level.trim()));
  const checking = step.step === "checking" || step.step === "saving";
  const edit = (field: keyof Draft) => (text: string) => {
    setDraft({ ...draft, [field]: text });
    setStep({ step: "editing" });
  };

  const send = async () => {
    setStep({ step: "saving" });
    const fields = {
      name: draft.name.trim(),
      unit: draft.unit.trim(),
      unit_cost: paiseOf(draft.cost),
      reorder_kit: levelOf(draft.kit),
      reorder_central: levelOf(draft.central),
    };
    const answer =
      consumable === null ? await api.addConsumable(fields) : await api.changeConsumable(consumable.code, fields);
    if (!answer.ok) {
      setStep({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    onSaved(answer.body, consumable === null ? form.added : form.saved);
  };

  const lines =
    consumable === null
      ? [
          form.confirm.adding(draft.name.trim(), draft.unit.trim(), rupees(paiseOf(draft.cost))),
          copy.levels(levelOf(draft.kit), levelOf(draft.central)),
        ]
      : changes(consumable, draft);
  const renamedInFsm = consumable !== null && consumable.fsm.item_id !== null && draft.name.trim() !== consumable.name;

  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>
        {consumable === null ? form.addTitle : form.changeTitle(consumable.name)}
      </legend>
      <div className={styles.fields}>
        <Field
          id={`${id}-name`}
          label={form.name}
          hint={form.nameHint}
          value={draft.name}
          maxLength={60}
          className={styles.text}
          onChange={edit("name")}
        />
        <Field
          id={`${id}-unit`}
          label={form.unit}
          hint={form.unitHint}
          value={draft.unit}
          maxLength={20}
          className={styles.number}
          onChange={edit("unit")}
        />
        <Field
          id={`${id}-cost`}
          label={form.cost}
          hint={form.costHint(rupees(maxUnitCost))}
          value={draft.cost}
          inputMode="decimal"
          maxLength={10}
          className={`${styles.number ?? ""} ${styles.amount ?? ""}`}
          onChange={edit("cost")}
        />
      </div>
      <div className={styles.fields}>
        <Field
          id={`${id}-kit`}
          label={form.kit}
          hint={form.levelHint}
          value={draft.kit}
          inputMode="numeric"
          maxLength={6}
          className={styles.number}
          onChange={edit("kit")}
        />
        <Field
          id={`${id}-central`}
          label={form.central}
          value={draft.central}
          inputMode="numeric"
          maxLength={6}
          className={styles.number}
          onChange={edit("central")}
        />
      </div>
      {checking && (
        <CheckPanel
          title={form.confirm.title}
          lines={lines.length === 0 ? [form.confirm.nothing] : lines}
          warnings={renamedInFsm ? [form.confirm.renamed] : []}
          send={form.confirm.send}
          sending={form.saving}
          back={form.confirm.back}
          busy={step.step === "saving"}
          ready={lines.length > 0}
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
            {consumable === null ? form.add : form.save}
          </Button>
          {onCancel !== null && (
            <Button variant="outline" size="small" className={styles.quiet} onClick={onCancel}>
              {form.cancel}
            </Button>
          )}
        </div>
      )}
      {step.step === "failed" && (
        <p className={styles.error} role="alert">
          {refusalOf(copy.errors, step)}
        </p>
      )}
    </fieldset>
  );
}
