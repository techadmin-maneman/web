// Adding or changing a consumable: its name, unit, cost, the levels each kind of place is low at, and its shelf life
// (docs/decisions/0087-consumables-and-stock.md, 0157-lots-and-expiry.md). The check shows each changed field, old
// beside new (ADR 0071). Every box holds text, so an empty level is no level, never a nought.

import { Field, TextInput } from "@maneman/ui/Field";
import { paiseFromRupees, rupees, rupeesTyped } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type Consumable, type Consumables } from "../api.ts";
import { settings } from "../content/settings.ts";
import styles from "../components/forms.module.css";
import { SettingForm, sentOf, useSteps } from "./SettingForm.tsx";

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
  readonly store: string;
  readonly central: string;
  readonly shelf: string;
}

const draftOf = (consumable: Consumable | null): Draft =>
  consumable === null
    ? { name: "", unit: "", cost: "", kit: "", store: "", central: "", shelf: "" }
    : {
        name: consumable.name,
        unit: consumable.unit,
        cost: rupeesTyped(consumable.unit_cost),
        kit: consumable.reorder_kit === null ? "" : String(consumable.reorder_kit),
        store: consumable.reorder_store === null ? "" : String(consumable.reorder_store),
        central: consumable.reorder_central === null ? "" : String(consumable.reorder_central),
        shelf: consumable.shelf_life_days === null ? "" : String(consumable.shelf_life_days),
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
  if (levelOf(draft.store) !== was.reorder_store) {
    lines.push(line(fields.store, levelWords(was.reorder_store), levelWords(levelOf(draft.store))));
  }
  if (levelOf(draft.central) !== was.reorder_central) {
    lines.push(line(fields.central, levelWords(was.reorder_central), levelWords(levelOf(draft.central))));
  }
  if (levelOf(draft.shelf) !== was.shelf_life_days) {
    lines.push(line(fields.shelf, copy.shelfLife(was.shelf_life_days), copy.shelfLife(levelOf(draft.shelf))));
  }
  return lines;
}

/** A whole figure, as typed; empty for none. */
function Figure(props: { label: string; value: string; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} className={styles.field}>
      {(control) => (
        <TextInput
          {...control}
          className={styles.figureBox}
          inputMode="numeric"
          maxLength={6}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
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
  onSaved: (consumables: Consumables, said: string) => void;
  onCancel: (() => void) | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(consumable));
  const ready =
    draft.name.trim() !== "" &&
    draft.unit.trim() !== "" &&
    RUPEES.test(draft.cost.trim()) &&
    paiseFromRupees(draft.cost) <= maxUnitCost &&
    [draft.kit, draft.store, draft.central, draft.shelf].every(
      (level) => level.trim() === "" || WHOLE.test(level.trim()),
    );
  const steps = useSteps(
    async () => {
      const fields = {
        name: draft.name.trim(),
        unit: draft.unit.trim(),
        unit_cost: paiseFromRupees(draft.cost),
        reorder_kit: levelOf(draft.kit),
        reorder_store: levelOf(draft.store),
        reorder_central: levelOf(draft.central),
        shelf_life_days: levelOf(draft.shelf),
      };
      const answer =
        consumable === null ? await api.addConsumable(fields) : await api.changeConsumable(consumable.code, fields);
      return sentOf(answer, (consumables) => ({ consumables }));
    },
    (sent) => {
      onSaved(sent.consumables, consumable === null ? form.added : form.saved);
    },
  );
  const edit = (field: keyof Draft) => (text: string) => {
    setDraft({ ...draft, [field]: text });
    steps.edit();
  };

  const lines =
    consumable === null
      ? [
          form.confirm.adding(draft.name.trim(), draft.unit.trim(), rupees(paiseFromRupees(draft.cost))),
          copy.levels({ kit: levelOf(draft.kit), store: levelOf(draft.store), central: levelOf(draft.central) }),
          copy.shelfLife(levelOf(draft.shelf)),
        ]
      : changes(consumable, draft);

  return (
    <SettingForm
      title={consumable === null ? form.addTitle : form.changeTitle(consumable.name)}
      steps={steps}
      ready={ready}
      errors={copy.errors}
      onCancel={onCancel}
      sendable={lines.length > 0}
      checking={(lines.length === 0 ? [form.confirm.nothing] : lines).map((line) => (
        <p className={styles.checkLine} key={line}>
          {line}
        </p>
      ))}
    >
      <div className={styles.fields}>
        <Field label={form.name} className={styles.field}>
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
        <Field label={form.unit} className={styles.field}>
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
        <Field label={form.cost} className={styles.field}>
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
        <Figure label={form.kit} value={draft.kit} onChange={edit("kit")} />
        <Figure label={form.store} value={draft.store} onChange={edit("store")} />
        <Figure label={form.central} value={draft.central} onChange={edit("central")} />
        <Figure label={form.shelf} value={draft.shelf} onChange={edit("shelf")} />
      </div>
    </SettingForm>
  );
}
