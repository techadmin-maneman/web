// The rules a city sets for itself: the check-in radius and the reminder time, each the national rule's until the city
// sets its own, which is checked as the national rule is (docs/decisions/0198-cities-as-data.md).

import { Panel } from "@maneman/ui/Panel";
import { Field, NumberInput, Select } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { useState } from "react";
import { cities } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { ActionCheck, SettingForm, sentOf, useSteps } from "../settings/index.ts";
import form from "../components/forms.module.css";
import type { Cities, CityRuleName } from "./types.ts";
import { citiesApi } from "./cities-api.ts";

const copy = cities.rules;

function RuleForm(props: { city: string; rule: CityRuleName; now: number | null; onSaved: () => void }) {
  const [figure, setFigure] = useState(props.now === null ? "" : String(props.now));
  const name = copy.names[props.rule];
  const steps = useSteps(
    async () => sentOf(await citiesApi.setRule(props.city, props.rule, { value: Number(figure) }), () => ({})),
    props.onSaved,
  );
  const was = props.now === null ? copy.national : String(props.now);
  return (
    <SettingForm
      title={copy.setTitle(name, props.city)}
      steps={steps}
      ready={/^\d{1,4}$/.test(figure.trim())}
      errors={copy.errors}
      onCancel={null}
      checking={<p className={form.checkLine}>{copy.line(name, was, figure.trim())}</p>}
    >
      <Field label={`${copy.figure} (${copy.units[props.rule]})`} className={form.field}>
        {(control) => (
          <NumberInput
            {...control}
            className={form.figureBox}
            value={figure}
            onChange={(event) => {
              setFigure(event.target.value);
              steps.edit();
            }}
          />
        )}
      </Field>
    </SettingForm>
  );
}

function RuleRow(props: { city: string; rule: CityRuleName; own: number | null; onSaved: () => void }) {
  const access = useAccess();
  const name = copy.names[props.rule];
  return (
    <div className={form.rule}>
      <p className={form.ruleTitle}>
        {name}: {props.own === null ? copy.national : copy.own(`${String(props.own)} ${copy.units[props.rule]}`)}
      </p>
      {access.mayCall("PATCH /api/cities/{name}/rules/{rule}") && (
        <RuleForm
          key={`${props.city}:${String(props.own)}`}
          city={props.city}
          rule={props.rule}
          now={props.own}
          onSaved={props.onSaved}
        />
      )}
      {props.own !== null && access.mayCall("DELETE /api/cities/{name}/rules/{rule}") && (
        <ActionCheck
          label={copy.back}
          question={copy.backQuestion(name, props.city)}
          send={async () => sentOf(await citiesApi.removeRule(props.city, props.rule), () => ({}))}
          onDone={props.onSaved}
          errors={copy.errors}
        />
      )}
    </div>
  );
}

export function CityRules({ cities, onSaved }: { cities: Cities; onSaved: () => void }) {
  const [city, setCity] = useState(cities.cities[0]?.name ?? "");
  const [said, setSaid] = useState<string | null>(null);
  const ownOf = (rule: CityRuleName): number | null => {
    const set = cities.rules.find((each) => each.city === city && each.rule === rule)?.value;
    return typeof set === "number" ? set : null;
  };
  const saved = () => {
    setSaid(copy.saved);
    onSaved();
  };
  return (
    <Panel titleId="city-rules" title={copy.panel}>
      <p className={form.note}>{copy.note}</p>
      <Field label={copy.city} className={form.field}>
        {(control) => (
          <Select
            {...control}
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
              setSaid(null);
            }}
          >
            {cities.cities.map((each) => (
              <option key={each.name} value={each.name}>
                {each.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {cities.rule_names.map((rule) => (
        <RuleRow key={`${city}:${rule}`} city={city} rule={rule} own={ownOf(rule)} onSaved={saved} />
      ))}
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
    </Panel>
  );
}
