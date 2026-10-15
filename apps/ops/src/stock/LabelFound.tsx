// A label scanned on the Stock page (docs/decisions/0162-scanning-labels.md): the piece it names, its lot and expiry,
// where it is now, and every change to it, oldest first.

import type { Success } from "@maneman/web-kit/api";
import { ScanField } from "@maneman/ui/ScanField";
import { fullDate, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type Stock } from "../api.ts";
import type { paths } from "../api-schema.ts";
import { stockLabels as copy } from "../content/stock-labels.ts";
import form from "../components/forms.module.css";
import { recordedBy } from "../lib/who.ts";
import { placeName } from "./StockForm.tsx";
import styles from "./label-found.module.css";
import { Refusal } from "../components/Refusal.tsx";
import { stockApi } from "./stock-api.ts";

type StockUnitFound = Success<paths["/api/stock/units/{code}"]["get"]>;

type Looked =
  | { readonly state: "none" }
  | { readonly state: "missing" }
  | { readonly state: "found"; readonly unit: StockUnitFound };

const when = (at: string) => `${shortDate(indiaDate(at))}, ${indiaClock(at)}`;

function Found(props: {
  unit: StockUnitFound;
  named: (code: string) => string;
  place: (id: string | null) => string | null;
  state: (key: keyof typeof copy.states) => string;
  by: (actor: string) => string;
}) {
  const { unit, named, place, state, by } = props;
  return (
    <div className={styles.found} role="status">
      <p className={form.note}>
        <strong>{unit.code}</strong> · {named(unit.consumable_code)}
        {unit.lot_code !== null && ` · ${unit.lot_code}`}
        {unit.expires_on !== null && ` · ${copy.expires(fullDate(unit.expires_on))}`}
      </p>
      <p className={form.note}>{copy.where(state(unit.state), place(unit.place_id))}</p>
      <ul className={styles.history} aria-label={copy.history}>
        {unit.history.map((line, index) => (
          <li key={`${line.at}-${String(index)}`}>
            {when(line.at)} · {copy.where(state(line.state), place(line.place_id))} · {by(line.by)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LabelFound({ stock }: { stock: Stock }) {
  const [looked, setLooked] = useState<Looked>({ state: "none" });
  const named = (code: string) => stock.consumables.find((each) => each.code === code)?.name ?? code;
  const place = (id: string | null) => (id === null ? null : placeName(stock, id));
  const state = (key: keyof typeof copy.states) => copy.states[key];
  /** A technician by their kit's name; anyone else as the Activity page names them. */
  const by = (actor: string) =>
    stock.places.some((each) => each.id === actor) ? placeName(stock, actor) : recordedBy(actor);
  const find = async (label: string) => {
    const answer = await stockApi.unit(label);
    setLooked(answer.ok ? { state: "found", unit: answer.body } : { state: "missing" });
  };
  return (
    <div className={form.group}>
      <ScanField
        className={form.field}
        words={{ ...copy.scan, label: copy.find }}
        onScan={(label) => void find(label)}
      />
      {looked.state === "missing" && <Refusal className={form.error} said={copy.notFound} />}
      {looked.state === "found" && <Found unit={looked.unit} named={named} place={place} state={state} by={by} />}
    </div>
  );
}
