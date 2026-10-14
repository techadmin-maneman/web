// Settings, Consumables, Hair systems (docs/decisions/0156-hair-systems-in-stock.md): a stock code for each product,
// base size, colour, grey and density kept, counted in pieces in the stock ledger beside the consumables. Its name is
// made from its spec; its cost and levels change in the list above, as any consumable's do.

import { Field, NumberInput, Select } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, client, type Consumables as ConsumableList } from "../api.ts";
import { settings } from "../content/settings.ts";
import styles from "../components/forms.module.css";
import { SettingForm, useSteps } from "./SettingForm.tsx";

const copy = settings.consumables.hairSystems;

/** The suppliers' colour codes and densities, as the hair profile takes them. */
const COLOURS = ["1", "1B", "2", "3", "4", "5", "6", "7", "8"] as const;
const DENSITIES = [80, 100, 120, 140] as const;

interface Draft {
  readonly product: string;
  readonly width: string;
  readonly length: string;
  readonly colour: string;
  readonly grey: string;
  readonly density: string;
  readonly cost: string;
  readonly kit: string;
  readonly store: string;
  readonly central: string;
}

const INCHES = /^\d{1,2}(\.\d)?$/;
const WHOLE = /^\d{1,6}$/;
const RUPEES = /^\d{1,7}(\.\d{1,2})?$/;

function HairSystemChoice(props: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label} className={styles.field}>
      {(control) => (
        <Select
          {...control}
          className={styles.choiceBox}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map(([value, words]) => (
            <option key={value} value={value}>
              {words}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function Figure(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={props.label} className={styles.field}>
      {(control) => (
        <NumberInput
          {...control}
          className={styles.figureBox}
          type="text"
          inputMode="decimal"
          maxLength={10}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

const level = (text: string) => (text.trim() === "" ? null : Number(text));

function readyOf(draft: Draft): boolean {
  const optionalWhole = (text: string) => text.trim() === "" || WHOLE.test(text.trim());
  return (
    draft.product !== "" &&
    INCHES.test(draft.width.trim()) &&
    INCHES.test(draft.length.trim()) &&
    WHOLE.test(draft.grey.trim()) &&
    Number(draft.grey) <= 100 &&
    RUPEES.test(draft.cost.trim()) &&
    optionalWhole(draft.kit) &&
    optionalWhole(draft.store) &&
    optionalWhole(draft.central)
  );
}

/** The spec a stock code is made to, and what one costs and the levels it is low at. */
function SpecFields({
  products,
  draft,
  edit,
}: {
  products: readonly (readonly [string, string])[];
  draft: Draft;
  edit: (field: keyof Draft) => (value: string) => void;
}) {
  return (
    <>
      <div className={styles.fields}>
        <HairSystemChoice label={copy.product} value={draft.product} options={products} onChange={edit("product")} />
        <Figure label={copy.width} value={draft.width} onChange={edit("width")} />
        <Figure label={copy.length} value={draft.length} onChange={edit("length")} />
        <HairSystemChoice
          label={copy.colour}
          value={draft.colour}
          options={COLOURS.map((each) => [each, `#${each}`] as const)}
          onChange={edit("colour")}
        />
        <Figure label={copy.grey} value={draft.grey} onChange={edit("grey")} />
        <HairSystemChoice
          label={copy.density}
          value={draft.density}
          options={DENSITIES.map((each) => [String(each), `${String(each)}%`] as const)}
          onChange={edit("density")}
        />
      </div>
      <div className={styles.fields}>
        <Figure label={copy.cost} value={draft.cost} onChange={edit("cost")} />
        <Figure label={copy.kit} value={draft.kit} onChange={edit("kit")} />
        <Figure label={copy.store} value={draft.store} onChange={edit("store")} />
        <Figure label={copy.central} value={draft.central} onChange={edit("central")} />
      </div>
    </>
  );
}

/** What the API takes for a draft. */
const bodyOf = (draft: Draft) => ({
  product: draft.product,
  base_width_in: Number(draft.width),
  base_length_in: Number(draft.length),
  colour: COLOURS.find((each) => each === draft.colour) ?? "1B",
  grey_percent: Number(draft.grey),
  density_percent: DENSITIES.find((each) => String(each) === draft.density) ?? 100,
  unit_cost: paiseFromRupees(draft.cost),
  reorder_kit: level(draft.kit),
  reorder_store: level(draft.store),
  reorder_central: level(draft.central),
});

/** What the check says will be added: the spec the code is made to, what one costs, and its levels. */
function checkLines(draft: Draft, productName: string): string[] {
  const level = (text: string) => (text.trim() === "" ? null : Number(text));
  return [
    copy.adding(
      `${productName} ${draft.width}x${draft.length} ${draft.colour}, ${draft.grey}% grey, ${draft.density}%`,
      rupees(paiseFromRupees(draft.cost)),
    ),
    settings.consumables.levels({ kit: level(draft.kit), store: level(draft.store), central: level(draft.central) }),
  ];
}

export function HairSystemForm({
  consumables,
  onSaved,
}: {
  consumables: ConsumableList;
  onSaved: (consumables: ConsumableList, said: string) => void;
}) {
  const products = consumables.services.filter((each) => each.visit_type === "first_fit" && each.retired_date === null);
  const blank: Draft = {
    product: products[0]?.tier ?? "",
    width: "",
    length: "",
    colour: "1B",
    grey: "0",
    density: "100",
    cost: "",
    kit: "",
    store: "",
    central: "",
  };
  const [draft, setDraft] = useState<Draft>(blank);
  const steps = useSteps(
    async () => {
      const added = await client.post("/api/hair-systems", { body: bodyOf(draft) });
      // The list is read again, with the new code in it.
      const answer = added.ok ? await api.consumables() : added;
      return answer.ok
        ? { ok: true as const, consumables: answer.body }
        : { ok: false as const, code: answer.code, fields: answer.fields };
    },
    (sent) => {
      setDraft(blank);
      steps.edit();
      onSaved(sent.consumables, copy.added);
    },
  );
  const edit = (field: keyof Draft) => (value: string) => {
    setDraft({ ...draft, [field]: value });
    steps.edit();
  };
  const productName = products.find((each) => each.tier === draft.product)?.name ?? draft.product;
  return (
    <Panel titleId="hair-systems" title={copy.title} className={styles.panel}>
      <p className={styles.note}>{copy.intro}</p>
      {products.length === 0 ? (
        <p className={styles.note}>{copy.noProducts}</p>
      ) : (
        <SettingForm
          title={copy.formTitle}
          steps={steps}
          ready={readyOf(draft)}
          errors={copy.errors}
          onCancel={null}
          checking={checkLines(draft, productName).map((line) => (
            <p className={styles.checkLine} key={line}>
              {line}
            </p>
          ))}
        >
          <SpecFields products={products.map((each) => [each.tier, each.name] as const)} draft={draft} edit={edit} />
        </SettingForm>
      )}
    </Panel>
  );
}
