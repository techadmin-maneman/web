// Stock · Labels (docs/decisions/0161-pieces-as-units.md): the labels of the hair system pieces a place holds, by each
// batch labelled together, the latest ticked to print; the pieces a place held before labels, labelled here; and a
// consumable lot's label, for its boxes, in as many copies as there are boxes. Any label scanned here finds its piece
// (docs/decisions/0162-scanning-labels.md).

import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Checkbox, ChoiceGroup, Field, NumberInput, Select } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { fullDate, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Stock, type StockUnits } from "../api.ts";
import { stockLabels as copy } from "../content/stock-labels.ts";
import { useAccess } from "../lib/access.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { LabelFound } from "./LabelFound.tsx";
import { LabelSheet, type PrintedLabel } from "./LabelSheet.tsx";
import { placeName } from "./StockForm.tsx";
import styles from "./labels.module.css";
import { holdingOf } from "./holdings.ts";
import { Refusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { stockApi } from "./stock-api.ts";

/** The item and place whose labels the panel shows. */
export interface LabelsFor {
  readonly code: string;
  readonly place: string;
}

const lotLine = (lotCode: string | null, expiresOn: string | null): string | null => {
  if (lotCode === null) return null;
  return expiresOn === null ? lotCode : `${lotCode} · ${copy.expires(fullDate(expiresOn))}`;
};

type Unit = StockUnits["units"][number];

/** The units labelled together, by when, the latest first, as the API lists them. */
function batchesOf(units: readonly Unit[]): { readonly at: string; readonly units: readonly Unit[] }[] {
  const batches: { at: string; units: Unit[] }[] = [];
  for (const unit of units) {
    const last = batches.at(-1);
    if (last?.at === unit.labelled_at) last.units.push(unit);
    else batches.push({ at: unit.labelled_at, units: [unit] });
  }
  return batches;
}

/** The batches labelled together, the latest ticked, and the labels of those ticked printed. */
function Batches({ units, name }: { units: readonly Unit[]; name: string }) {
  const batches = batchesOf(units);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(batches.slice(0, 1).map((each) => each.at)));
  const [printing, setPrinting] = useState<readonly PrintedLabel[] | null>(null);
  if (batches.length === 0) return <p className={form.note}>{copy.noUnits}</p>;
  const toPrint = batches.filter((batch) => ticked.has(batch.at)).flatMap((batch) => batch.units);
  const toggle = (batch: string) => {
    const next = new Set(ticked);
    if (!next.delete(batch)) next.add(batch);
    setTicked(next);
  };
  return (
    <>
      <ChoiceGroup className={styles.batches} legend={copy.batchesLegend} legendLook="hidden">
        {batches.map((batch) => (
          <Checkbox
            key={batch.at}
            label={copy.batch(`${shortDate(indiaDate(batch.at))}, ${indiaClock(batch.at)}`, batch.units.length)}
            checked={ticked.has(batch.at)}
            onChange={() => {
              toggle(batch.at);
            }}
          />
        ))}
      </ChoiceGroup>
      {toPrint.length > 0 && (
        <FormActions>
          <Button
            variant="primary"
            size="small"
            disabled={printing !== null}
            onClick={() => {
              setPrinting(
                toPrint.map((unit) => ({ code: unit.code, name, lot: lotLine(unit.lot_code, unit.expires_on) })),
              );
            }}
          >
            {printing === null ? copy.print(toPrint.length) : copy.printing}
          </Button>
        </FormActions>
      )}
      {printing !== null && (
        <LabelSheet
          labels={printing}
          onPrinted={() => {
            setPrinting(null);
          }}
        />
      )}
    </>
  );
}

function PieceLabels({ name, at }: { name: string; at: LabelsFor }) {
  const load = useCallback(() => stockApi.units({ consumable_code: at.code, place_id: at.place }), [at.code, at.place]);
  const [loaded, retry] = useLoad(load);
  /** The units after a labelling, and how many labellings: each ticks its own batch afresh. */
  const [after, setAfter] = useState<{ readonly units: StockUnits; readonly times: number } | null>(null);
  const [labelling, setLabelling] = useState<"idle" | "busy" | "failed">("idle");
  const access = useAccess();
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const units = after?.units ?? loaded.value;
  const toLabel = Math.min(units.unlabelled, units.max_labelled);

  const label = async () => {
    setLabelling("busy");
    const body = { consumable_code: at.code, place_id: at.place, quantity: toLabel };
    const answer = await stockApi.addUnits(body);
    if (!answer.ok) {
      setLabelling("failed");
      return;
    }
    setAfter({ units: answer.body, times: (after?.times ?? 0) + 1 });
    setLabelling("idle");
  };

  return (
    <>
      {units.unlabelled > 0 && (
        <p className={form.note}>
          {copy.unlabelled(units.unlabelled)}{" "}
          {access.mayCall("POST /api/stock/units") && (
            <Button variant="outline" size="small" disabled={labelling === "busy"} onClick={() => void label()}>
              {labelling === "busy" ? copy.labelling : copy.labelThem(toLabel)}
            </Button>
          )}
        </p>
      )}
      {labelling === "failed" && <Refusal className={form.error} said={copy.notLabelled} />}
      <Batches key={String(after?.times ?? 0)} units={units.units} name={name} />
    </>
  );
}

const MAX_COPIES = 200;

/** The lots a place holds of one consumable. */
const lotsAt = (stock: Stock, at: LabelsFor) => holdingOf(stock, at.code, at.place)?.lots ?? [];

function LotLabels({ stock, name, at }: { stock: Stock; name: string; at: LabelsFor }) {
  const lots = lotsAt(stock, at);
  const [lotId, setLotId] = useState(lots[0]?.id ?? "");
  const [copies, setCopies] = useState("1");
  const [failed, setFailed] = useState(false);
  const [printing, setPrinting] = useState<readonly PrintedLabel[] | null>(null);
  const lot = lots.find((each) => each.id === lotId);
  const count = /^\d{1,3}$/.test(copies) ? Number(copies) : 0;
  if (lots.length === 0) return <p className={form.note}>{copy.noLots}</p>;

  const print = async () => {
    if (lot === undefined) return;
    setFailed(false);
    const answer = await stockApi.labelLot(lot.id);
    if (!answer.ok) {
      setFailed(true);
      return;
    }
    const printed = { code: answer.body.label, name, lot: lotLine(lot.lot_code, lot.expires_on) };
    setPrinting(Array.from({ length: count }, () => printed));
  };

  return (
    <>
      <div className={form.fields}>
        <Field label={copy.lot} className={form.field}>
          {(control) => (
            <Select
              {...control}
              value={lotId}
              onChange={(event) => {
                setLotId(event.target.value);
              }}
            >
              {lots.map((each) => (
                <option key={each.id} value={each.id}>
                  {lotLine(each.lot_code, each.expires_on)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={copy.copies} className={form.field}>
          {(control) => (
            <NumberInput
              {...control}
              min={1}
              max={MAX_COPIES}
              value={copies}
              onChange={(event) => {
                setCopies(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      {failed && <Refusal className={form.error} said={copy.noLabel} />}
      <FormActions>
        <Button
          variant="primary"
          size="small"
          disabled={count < 1 || count > MAX_COPIES || printing !== null}
          onClick={() => void print()}
        >
          {printing === null ? copy.print(count) : copy.printing}
        </Button>
      </FormActions>
      {printing !== null && (
        <LabelSheet
          labels={printing}
          onPrinted={() => {
            setPrinting(null);
          }}
        />
      )}
    </>
  );
}

/** One of the items or the places, by name. */
function LabelChoice(props: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label} className={form.field}>
      {(control) => (
        <Select
          {...control}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** The panel, opened on `focus` where given: a hair system's delivery opens its labels at the warehouse. */
export function Labels({ stock, focus }: { stock: Stock; focus: LabelsFor | null }) {
  const [code, setCode] = useState(focus?.code ?? stock.consumables.find((each) => !each.retired)?.code ?? "");
  const [place, setPlace] = useState(focus?.place ?? stock.places[0]?.id ?? "");
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus !== null) panel.current?.scrollIntoView({ block: "start" });
  }, [focus]);
  const consumable = stock.consumables.find((each) => each.code === code);
  const at = { code, place };
  const access = useAccess();
  return (
    <Panel titleId="stock-labels" title={copy.title} ref={panel}>
      {access.mayCall("GET /api/stock/units/{code}") && <LabelFound stock={stock} />}
      <div className={form.fields}>
        <LabelChoice
          label={copy.item}
          value={code}
          options={stock.consumables.map((each) => [each.code, each.name] as const)}
          onChange={setCode}
        />
        <LabelChoice
          label={copy.place}
          value={place}
          options={stock.places.map((each) => [each.id, placeName(stock, each.id)] as const)}
          onChange={setPlace}
        />
      </div>
      {consumable?.hair_system === true ? (
        <PieceLabels key={`${code}:${place}`} name={consumable.name} at={at} />
      ) : (
        <LotLabels key={`${code}:${place}`} stock={stock} name={consumable?.name ?? code} at={at} />
      )}
    </Panel>
  );
}
