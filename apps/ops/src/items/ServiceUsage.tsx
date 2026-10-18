// What each service is expected to use, where the technician's steppers start
// (docs/decisions/0087-consumables-and-stock.md), a service at a time; a retired service is listed too, since a visit
// sold before it was retired is still done. Each figure changes where it reads (docs/decisions/0212-editing-in-place.md),
// and the service's list goes whole with it. An empty box is none.

import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { longDate } from "@maneman/web-kit/dates";
import { amountOf } from "@maneman/web-kit/figures";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type Consumables, type ServiceUse } from "../api.ts";
import { figureOrNone, FigureRow } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { dispatch } from "../content.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { itemsApi } from "./items-api.ts";

const copy = settings.consumables;
const words = copy.usage;

const keyOf = (service: ServiceUse) => `${service.visit_type}/${service.tier}`;
const serviceName = (service: ServiceUse) =>
  words.serviceName(service.name, service.retired_date === null ? null : longDate(service.retired_date));

/**
 * Every consumable offered, and any retired one this service still expects, so a save never drops it unseen. Never a
 * hair system: it is fitted to the client, not used by a service.
 */
const listedFor = (consumable: Consumables["consumables"][number], expected: ReadonlyMap<string, number>) =>
  consumable.hair_system === null && (consumable.offered || expected.has(consumable.code));

/** The services, a kind of visit at a time. */
function ServiceChoice(props: { consumables: Consumables; chosen: string; onChoose: (key: string) => void }) {
  const { services } = props.consumables;
  return (
    <Field label={words.service} className={form.field}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.chosen}
          onChange={(event) => {
            props.onChoose(event.target.value);
          }}
        >
          {[...new Set(services.map((each) => each.visit_type))].map((kind) => (
            <optgroup key={kind} label={dispatch.typeNames[kind]}>
              {services
                .filter((each) => each.visit_type === kind)
                .map((each) => (
                  <option key={keyOf(each)} value={keyOf(each)}>
                    {serviceName(each)}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function ServiceUsage({
  consumables,
  onSaved,
}: {
  consumables: Consumables;
  onSaved: (consumables: Consumables) => void;
}) {
  const [chosen, setChosen] = useState(() => {
    const first = consumables.services[0];
    return first === undefined ? "" : keyOf(first);
  });
  const mayChange = useAccess().mayCall("POST /api/service-usage");
  const service = consumables.services.find((each) => keyOf(each) === chosen);
  const expected = new Map(service?.expected.map((each) => [each.code, each.quantity]) ?? []);
  const listed = consumables.consumables.filter((each) => listedFor(each, expected));

  const save = (code: string) => async (typed: string) => {
    const quantity = figureOrNone(typed);
    if (service === undefined) return errorText(copy.errors, { code: "not_found" });
    if (quantity === undefined || (quantity ?? 0) > 999) return words.whole;
    const items = listed.flatMap((each) => {
      const figure = each.code === code ? quantity : (expected.get(each.code) ?? null);
      return figure === null || figure === 0 ? [] : [{ code: each.code, quantity: figure }];
    });
    const answer = await itemsApi.setServiceUsage({ visit_type: service.visit_type, tier: service.tier, items });
    if (!answer.ok) return errorText(copy.errors, answer);
    onSaved(answer.body);
    return null;
  };

  return (
    <Panel titleId="service-usage" title={words.title} padded>
      <ServiceChoice consumables={consumables} chosen={chosen} onChoose={setChosen} />
      {listed.length === 0 ? (
        <Note>{words.noneOffered}</Note>
      ) : (
        <div className={form.record}>
          {listed.map((each) => {
            const quantity = expected.get(each.code) ?? null;
            return (
              <FigureRow
                key={`${chosen}/${each.code}`}
                label={each.name}
                value={quantity}
                shown={quantity === null ? words.none : amountOf(quantity, each.unit)}
                unit={each.unit}
                mayChange={mayChange}
                save={save(each.code)}
              />
            );
          })}
        </div>
      )}
    </Panel>
  );
}
