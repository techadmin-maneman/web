// A city's record (docs/decisions/0198-cities-as-data.md): its name, its state for GST, its zone, and whether we serve
// it and offer it, each changed where it reads; a new name moves every row that names it. Beneath, the rules it sets
// for itself, each the national rule's until it sets its own, and the national rule's again once emptied.

import type { Sent } from "@maneman/web-kit/api";
import { errorText } from "@maneman/web-kit/refusal";
import type { paths } from "../api-schema.ts";
import { ChoiceRow, figureOrNone, FigureRow, TextRow } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { cities as words } from "../content/cities.ts";
import { useAccess } from "../lib/access.ts";
import { citiesApi } from "./cities-api.ts";
import type { Cities, City, CityRuleName } from "./types.ts";
import styles from "./cities.module.css";

const copy = words.form;
const rules = words.rules;

type Fields = Sent<paths["/api/cities/{name}"]["patch"]>;

/** The city as the API takes it, each field as it stands. */
const fieldsOf = (city: City): Fields => ({
  name: city.name,
  state_code: city.state_code ?? "",
  state: city.state ?? "",
  zone: city.zone,
  served: city.served,
  active: city.active,
});

interface Props {
  readonly city: City;
  readonly cities: Cities;
  /** Reads the page again, so a value kept shows as it now stands. */
  readonly reread: () => Promise<void>;
  readonly onRenamed: (name: string) => void;
}

/** A rule the city sets for itself: its figure, or the national rule's while it sets none. */
function OwnRule({ city, cities, reread, rule }: Omit<Props, "onRenamed"> & { readonly rule: CityRuleName }) {
  const access = useAccess();
  const set = cities.rules.find((each) => each.city === city.name && each.rule === rule)?.value;
  const own = typeof set === "number" ? set : null;
  const unit = rules.units[rule];
  return (
    <FigureRow
      label={rules.names[rule]}
      value={own}
      shown={own === null ? rules.national : `${String(own)} ${unit}`}
      unit={unit}
      mayChange={access.mayCall("PATCH /api/cities/{name}/rules/{rule}")}
      save={async (typed) => {
        const figure = figureOrNone(typed);
        if (figure === undefined) return rules.errors.value;
        if (figure === null && own === null) return null;
        const answer =
          figure === null
            ? await citiesApi.removeRule(city.name, rule)
            : await citiesApi.setRule(city.name, rule, { value: figure });
        if (!answer.ok) return errorText(rules.errors, answer);
        await reread();
        return null;
      }}
    />
  );
}

export function CityRecord(props: Props) {
  const { city, cities, reread } = props;
  const mayChange = useAccess().mayCall("PATCH /api/cities/{name}");
  const save = async (change: Partial<Fields>) => {
    const answer = await citiesApi.changeCity(city.name, { ...fieldsOf(city), ...change });
    if (!answer.ok) return errorText(copy.errors, answer);
    if (answer.body.city.name !== city.name) props.onRenamed(answer.body.city.name);
    await reread();
    return null;
  };
  const yesNo = [
    ["yes", copy.yes],
    ["no", copy.no],
  ] as const;
  return (
    <>
      <div className={form.record}>
        <TextRow
          label={copy.name}
          value={city.name}
          maxLength={60}
          mayChange={mayChange}
          save={(typed) => save({ name: typed.trim() })}
        />
        <TextRow
          label={copy.stateCode}
          value={city.state_code ?? ""}
          maxLength={2}
          mayChange={mayChange}
          save={(typed) => save({ state_code: typed.trim().toUpperCase() })}
        />
        <TextRow
          label={copy.state}
          value={city.state ?? ""}
          maxLength={60}
          mayChange={mayChange}
          save={(typed) => save({ state: typed.trim() })}
        />
        <ChoiceRow
          label={copy.zone}
          value={city.zone ?? ""}
          choices={[["", copy.noZone], ...cities.zones.map((zone) => [zone, zone] as const)]}
          mayChange={mayChange}
          save={(zone) => save({ zone: zone === "" ? null : zone })}
        />
        <ChoiceRow
          label={copy.served}
          value={city.served ? "yes" : "no"}
          choices={yesNo}
          mayChange={mayChange}
          save={(said) => save({ served: said === "yes" })}
        />
        <ChoiceRow
          label={copy.active}
          value={city.active ? "yes" : "no"}
          choices={yesNo}
          mayChange={mayChange}
          save={(said) => save({ active: said === "yes" })}
        />
      </div>
      <p className={styles.renames}>{copy.renames(city.name)}</p>
      <section className={styles.rules} aria-labelledby="city-rules">
        <h3 id="city-rules" className={styles.rulesTitle}>
          {rules.panel}
        </h3>
        <div className={form.record}>
          {cities.rule_names.map((rule) => (
            <OwnRule key={rule} city={city} cities={cities} reread={reread} rule={rule} />
          ))}
        </div>
      </section>
    </>
  );
}
