// A consumable's record (docs/decisions/0087-consumables-and-stock.md, 0157-lots-and-expiry.md): its name, unit, cost,
// the levels each kind of place is low at, and its shelf life, each changed where it reads and sent alone. An empty
// level is no level, never a nought. Retiring, restoring and deleting sit at its foot.

import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { type Consumable, type ConsumableChange, type Consumables } from "../api.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { figureOrNone, FigureRow, MoneyRow, ReadRow, TextRow } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Restoring, Retiring, stateWords } from "./Retirement.tsx";
import { itemsApi } from "./items-api.ts";

const copy = settings.consumables;
const rows = copy.rows;

/** Rupees to the paisa, as typed: "12", "12.5", "12.50". */
const RUPEES = /^\d{1,7}(?:\.\d{1,2})?$/;

type Level = "reorder_kit" | "reorder_store" | "reorder_central";

interface Props {
  readonly consumable: Consumable;
  readonly consumables: Consumables;
  readonly onSaved: (consumables: Consumables) => void;
}

/** What the record's rows do: send the one value changed, and hand on the list it came back as. */
function useSave({ consumable, consumables, onSaved }: Props) {
  const errors = { ...copy.errors, unit_cost: copy.unitCostUpTo(rupees(consumables.max_unit_cost)) };
  const send = async (change: ConsumableChange) => {
    const answer = await itemsApi.changeConsumable(consumable.code, change);
    if (!answer.ok) return errorText(errors, answer);
    onSaved(answer.body);
    return null;
  };
  return {
    send,
    cost: (typed: string) => {
      const paise = paiseFromRupees(typed);
      if (!RUPEES.test(typed.trim()) || paise > consumables.max_unit_cost) return Promise.resolve(errors.unit_cost);
      return send({ unit_cost: paise });
    },
    figure: (field: Level | "shelf_life_days") => (typed: string) => {
      const figure = figureOrNone(typed);
      if (figure === undefined) return Promise.resolve(errors[field]);
      return send({ [field]: figure });
    },
  };
}

const levelShown = (level: number | null) => (level === null ? copy.noLevel : String(level));

export function ConsumableRecord(props: Props & { readonly onDeleted: (consumables: Consumables) => void }) {
  const { consumable } = props;
  const access = useAccess();
  const mayChange = access.mayCall("POST /api/consumables/{code}");
  const save = useSave(props);
  const levels: readonly (readonly [Level, string])[] = [
    ["reorder_kit", rows.kit],
    ["reorder_store", rows.store],
    ["reorder_central", rows.central],
  ];
  return (
    <>
      <div className={form.record}>
        <TextRow
          label={rows.name}
          value={consumable.name}
          maxLength={60}
          mayChange={mayChange}
          save={(typed) => save.send({ name: typed.trim() })}
        />
        <TextRow
          label={rows.unit}
          value={consumable.unit}
          maxLength={20}
          mayChange={mayChange}
          save={(typed) => save.send({ unit: typed.trim() })}
        />
        <MoneyRow label={rows.cost} paise={consumable.unit_cost} mayChange={mayChange} save={save.cost} />
        {levels.map(([field, label]) => (
          <FigureRow
            key={field}
            label={label}
            value={consumable[field]}
            shown={levelShown(consumable[field])}
            mayChange={mayChange}
            save={save.figure(field)}
          />
        ))}
        <FigureRow
          label={rows.shelf}
          value={consumable.shelf_life_days}
          shown={copy.shelfLife(consumable.shelf_life_days)}
          unit={copy.days}
          mayChange={mayChange}
          save={save.figure("shelf_life_days")}
        />
        <ReadRow label={rows.status} value={stateWords(consumable)} />
      </div>
      <div className={form.recordFoot}>
        {consumable.retired_from === null && access.mayCall("POST /api/consumables/{code}/retire") && (
          <Retiring consumable={consumable} today={props.consumables.today} onSaved={props.onSaved} />
        )}
        {consumable.retired_from !== null && access.mayCall("POST /api/consumables/{code}/restore") && (
          <Restoring consumable={consumable} onSaved={props.onSaved} />
        )}
        {access.mayCall("POST /api/consumables/{code}/delete") && (
          <DeleteAction
            name={consumable.name}
            send={() => itemsApi.deleteConsumable(consumable.code)}
            refusal={(code) => (code === "in_use" ? copy.inUse : errorText(copy.errors, { code }))}
            onDeleted={props.onDeleted}
          />
        )}
      </div>
    </>
  );
}
