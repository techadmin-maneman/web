// Adding a consumable, or changing one: its name, its unit, what one costs and
// the levels a kit and the central store are low at
// (docs/decisions/0087-consumables-and-stock.md). The boxes start from what the
// consumable is now; the check shows each field that changes, old beside new,
// before anything is sent (ADR 0071). Every box holds text: an empty level is
// no level, never a nought.

import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { Field, TextInput } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type Consumable, type Consumables } from "../api.ts";
import { settings } from "../content.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import styles from "../components/forms.module.css";

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

const levelOf = (text: string) => (text.trim() === "" ? null : Number(text));
const levelWords = (level: number | null) => (level === null ? form.confirm.noLevel : String(level));

/** What the change is, field by field, each old beside new; empty when nothing changes. */
function changes(was: Consumable, draft: Draft): string[] {
  const { fields, line } = form.confirm;
  const lines: string[] = [];
  if (draft.name.trim() !== was.name) lines.push(line(fields.name, was.name, draft.name.trim()));
  if (draft.unit.trim() !== was.unit) lines.push(line(fields.unit, was.unit, draft.unit.trim()));
  if (paiseFromRupees(draft.cost) !== was.unit_cost) {
    lines.push(line(fields.cost, rupees(was.unit_cost), rupees(paiseFromRupees(draft.cost))));
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
  const ready =
    draft.name.trim() !== "" &&
    draft.unit.trim() !== "" &&
    RUPEES.test(draft.cost.trim()) &&
    paiseFromRupees(draft.cost) <= maxUnitCost &&
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
      unit_cost: paiseFromRupees(draft.cost),
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
          form.confirm.adding(draft.name.trim(), draft.unit.trim(), rupees(paiseFromRupees(draft.cost))),
          copy.levels(levelOf(draft.kit), levelOf(draft.central)),
        ]
      : changes(consumable, draft);

  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>
        {consumable === null ? form.addTitle : form.changeTitle(consumable.name)}
      </legend>
      <div className={styles.fields}>
        <Field label={form.name} hint={form.nameHint} className={styles.field}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.areaBox}
              maxLength={60}
              value={draft.name}
              onChange={(event) => {
                edit("name")(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={form.unit} hint={form.unitHint} className={styles.field}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.figureBox}
              maxLength={20}
              value={draft.unit}
              onChange={(event) => {
                edit("unit")(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={form.cost} hint={form.costHint(rupees(maxUnitCost))} className={styles.field}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.amountBox}
              inputMode="decimal"
              maxLength={10}
              value={draft.cost}
              onChange={(event) => {
                edit("cost")(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <div className={styles.fields}>
        <Field label={form.kit} hint={form.levelHint} className={styles.field}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.figureBox}
              inputMode="numeric"
              maxLength={6}
              value={draft.kit}
              onChange={(event) => {
                edit("kit")(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={form.central} className={styles.field}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.figureBox}
              inputMode="numeric"
              maxLength={6}
              value={draft.central}
              onChange={(event) => {
                edit("central")(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      {checking && (
        <CheckPanel
          title={form.confirm.title}
          lines={lines.length === 0 ? [form.confirm.nothing] : lines}
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
          {errorText(copy.errors, step)}
        </p>
      )}
    </fieldset>
  );
}
