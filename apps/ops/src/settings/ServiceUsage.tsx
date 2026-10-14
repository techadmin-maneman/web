// What each service is expected to use: where the technician's steppers start
// on a job of it (docs/decisions/0087-consumables-and-stock.md). A service is
// one the console holds, by its name, a kind at a time
// (docs/decisions/0085-services-ops-can-edit.md); a retired one is here too,
// marked, since a visit sold before it was retired is still done. The whole
// list is sent at once, and the check shows each consumable whose figure
// changes, old beside new (ADR 0071). An empty box is none.

import { Fieldset, Label, Select, TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Consumables, type ServiceUse } from "../api.ts";
import { dispatch } from "../content.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { review } from "../content/common.ts";
import styles from "../components/forms.module.css";
import own from "./consumables.module.css";
import { SettingForm, sentOf, useSteps, type Sent } from "./SettingForm.tsx";

const copy = settings.consumables;
const words = copy.usage;

const keyOf = (service: ServiceUse) => `${service.visit_type}/${service.tier}`;
const serviceName = (service: ServiceUse) =>
  words.serviceName(service.name, service.retired_date === null ? null : longDate(service.retired_date));

/** Each consumable's box, as text: the figure the service expects, or empty for none. */
type Draft = Readonly<Record<string, string>>;

const draftOf = (service: ServiceUse | undefined): Draft =>
  Object.fromEntries((service?.expected ?? []).map((each) => [each.code, String(each.quantity)]));

/**
 * Every consumable offered, and any retired one this service still expects, so a save never drops it unseen. Never a
 * hair system: it is fitted to the client, not used by a service.
 */
const listedFor = (consumable: Consumables["consumables"][number], expected: ReadonlySet<string>) =>
  consumable.hair_system === null && (consumable.offered || expected.has(consumable.code));

/** The service chosen, and each listed consumable's box. */
function UsageFields(props: {
  consumables: Consumables;
  chosen: string;
  listed: Consumables["consumables"];
  draft: Draft;
  mayChange: boolean;
  onChoose: (key: string) => void;
  onFigure: (code: string, text: string) => void;
}) {
  const { consumables, listed, draft } = props;
  return (
    <>
      <div className={styles.field}>
        <Label htmlFor="usage-service">{words.service}</Label>
        <Select
          className={styles.select}
          id="usage-service"
          value={props.chosen}
          onChange={(event) => {
            props.onChoose(event.target.value);
          }}
        >
          {[...new Set(consumables.services.map((each) => each.visit_type))].map((kind) => (
            <optgroup key={kind} label={dispatch.typeNames[kind] ?? kind}>
              {consumables.services
                .filter((each) => each.visit_type === kind)
                .map((each) => (
                  <option key={keyOf(each)} value={keyOf(each)}>
                    {serviceName(each)}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
      </div>
      {listed.length === 0 ? (
        <p className={styles.note}>{words.noneOffered}</p>
      ) : (
        <ul className={own.uses}>
          {listed.map((each) => (
            <li className={own.use} key={each.code}>
              <Label htmlFor={`usage-${each.code}`}>{words.quantity(each.name, each.unit)}</Label>
              <TextInput
                className={styles.number}
                id={`usage-${each.code}`}
                inputMode="numeric"
                maxLength={3}
                readOnly={!props.mayChange}
                value={draft[each.code] ?? ""}
                onChange={(event) => {
                  props.onFigure(each.code, event.target.value);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface ServiceUsageProps {
  consumables: Consumables;
  onSaved: (consumables: Consumables) => void;
}

export function ServiceUsage({ consumables, onSaved }: ServiceUsageProps) {
  const [chosen, setChosen] = useState(() => {
    const first = consumables.services[0];
    return first === undefined ? "" : keyOf(first);
  });
  const service = consumables.services.find((each) => keyOf(each) === chosen);
  const [draft, setDraft] = useState<Draft>(() => draftOf(service));
  const [saved, setSaved] = useState(false);
  const mayChange = useAccess().mayCall("POST /api/service-usage");

  const expectedCodes = new Set(service?.expected.map((each) => each.code) ?? []);
  const listed = consumables.consumables.filter((each) => listedFor(each, expectedCodes));
  const was = new Map(service?.expected.map((each) => [each.code, each.quantity]) ?? []);
  const figure = (code: string) => (draft[code] ?? "").trim();
  const valid = listed.every((each) => figure(each.code) === "" || /^\d{1,3}$/.test(figure(each.code)));
  const items = listed.flatMap((each) => {
    const quantity = Number(figure(each.code));
    return figure(each.code) === "" || quantity === 0 ? [] : [{ code: each.code, quantity }];
  });
  const lines = listed.flatMap((each) => {
    const before = was.get(each.code) ?? null;
    const after = items.find((item) => item.code === each.code)?.quantity ?? null;
    if (before === after) return [];
    const said = (quantity: number | null) =>
      quantity === null ? words.confirm.none : `${String(quantity)} ${each.unit}`;
    return [words.confirm.line(each.name, said(before), said(after))];
  });
  const steps = useSteps(
    async (): Promise<Sent<{ next: Consumables }>> => {
      if (service === undefined) return { ok: false, code: "not_found" };
      const answer = await api.setServiceUsage({ visit_type: service.visit_type, tier: service.tier, items });
      return sentOf(answer, (next) => ({ next }));
    },
    (sent) => {
      setSaved(true);
      steps.edit();
      onSaved(sent.next);
    },
  );
  const title = service === undefined ? words.title : serviceName(service);
  const fields = (
    <UsageFields
      consumables={consumables}
      chosen={chosen}
      listed={listed}
      draft={draft}
      mayChange={mayChange}
      onChoose={(key) => {
        setChosen(key);
        setDraft(draftOf(consumables.services.find((each) => keyOf(each) === key)));
        setSaved(false);
        steps.edit();
      }}
      onFigure={(code, text) => {
        setDraft({ ...draft, [code]: text });
        setSaved(false);
        steps.edit();
      }}
    />
  );

  return (
    <Panel titleId="service-usage" title={words.title} className={styles.panel}>
      {mayChange ? (
        <SettingForm
          said={saved ? words.saved : null}
          title={title}
          steps={steps}
          ready={service !== undefined && listed.length > 0 && valid}
          errors={copy.errors}
          onCancel={null}
          sendable={lines.length > 0}
          checking={(lines.length === 0 ? [review.nothing] : lines).map((line) => (
            <p className={styles.checkLine} key={line}>
              {line}
            </p>
          ))}
        >
          {fields}
        </SettingForm>
      ) : (
        <Fieldset className={styles.group} legend={title} legendLook="title">
          {fields}
        </Fieldset>
      )}
    </Panel>
  );
}
