// What each service is expected to use, where the technician's steppers start
// (docs/decisions/0087-consumables-and-stock.md), a service at a time; a retired service is listed too, since a visit
// sold before it was retired is still done. Each figure changes where it reads (docs/decisions/0212-editing-in-place.md),
// and the service's list goes whole with it. An empty box is none.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { ChoiceOptions, Field, Select } from "@maneman/ui/Field";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { NoValue } from "@maneman/ui/NoValue";
import { RowHead } from "@maneman/ui/RowHead";
import { FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { SettingPairs } from "@maneman/ui/SettingsLayout";
import { amountOf } from "@maneman/web-kit/figures";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type Consumables, type ServiceUse } from "../api.ts";
import { figureOrNone, FigureRow } from "@maneman/ui/RecordRows";
import { dispatch } from "../content.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { itemsApi } from "./items-api.ts";
import styles from "./consumables.module.css";

const copy = settings.consumables;
const words = copy.usage;

const keyOf = (service: ServiceUse) => `${service.visit_type}/${service.tier}`;

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
    <Field label={words.service}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.chosen}
          onChange={(event) => {
            props.onChoose(event.target.value);
          }}
        >
          <ChoiceOptions
            choices={[
              ...services
                .filter((each) => each.retired_date === null)
                .map((each) => [keyOf(each), each.name, dispatch.typeNames[each.visit_type]] as const),
              ...services
                .filter((each) => each.retired_date !== null)
                .map((each) => [keyOf(each), each.name, words.retired] as const),
            ]}
          />
        </Select>
      )}
    </Field>
  );
}

/**
 * What each service offered expects of each consumable, as the redesign draws it: a service a row, an item a column,
 * each item offered or still expected by a service, retired or not, as demand counts it; Change, for those who may,
 * opens the figures to be set a service at a time.
 */
export function ServiceUsage({
  consumables,
  onSaved,
}: {
  consumables: Consumables;
  onSaved: (consumables: Consumables) => void;
}) {
  const mayChange = useAccess().mayCall("POST /api/service-usage");
  const services = consumables.services.filter((each) => each.retired_date === null);
  const stillExpected = new Set(services.flatMap((service) => service.expected.map((each) => each.code)));
  const items = consumables.consumables.filter(
    (each) => each.hair_system === null && (each.offered || stillExpected.has(each.code)),
  );
  return (
    <Panel
      titleId="service-usage"
      title={words.title}
      actions={
        mayChange && (
          <DrawerButton icon={ACTION_ICONS.pencil} label={words.change} title={words.title}>
            {() => <UsageEditor consumables={consumables} onSaved={onSaved} />}
          </DrawerButton>
        )
      }
    >
      {items.length === 0 || services.length === 0 ? (
        <EmptyState look="panel" line={words.noneOffered} />
      ) : (
        <TableScroll labelledBy="service-usage">
          <Table>
            <thead>
              <tr>
                <th scope="col">{words.visit}</th>
                {items.map((item) => (
                  <th key={item.code} scope="col" className={FIGURE}>
                    {item.name}
                    {/* A word apart, where a phone's card reads the head as one line. */}
                    {!item.offered && (
                      <>
                        {" "}
                        <span className={styles.retired}>{words.retired}</span>
                      </>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const expected = new Map(service.expected.map((each) => [each.code, each.quantity]));
                return (
                  <tr key={keyOf(service)}>
                    <RowHead>{service.name}</RowHead>
                    {items.map((item) => {
                      const quantity = expected.get(item.code);
                      return (
                        <td key={item.code} className={FIGURE}>
                          {quantity === undefined ? <NoValue /> : amountOf(quantity, item.unit)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}

/** The figures a service at a time, each changed where it reads, the service's whole list sent on each change. */
function UsageEditor({
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
    <>
      <ServiceChoice consumables={consumables} chosen={chosen} onChoose={setChosen} />
      {listed.length === 0 ? (
        <EmptyState look="panel" line={words.noneOffered} />
      ) : (
        <SettingPairs>
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
        </SettingPairs>
      )}
    </>
  );
}
