// A package's record (docs/decisions/0211-packages.md), opened beneath the list: the package itself, its first fit,
// its service visit, its replacement and its hair systems, each value changed where it reads
// (docs/decisions/0212-editing-in-place.md); retiring, selling again, its place in the order and deleting at its foot.

import { EditableRow } from "@maneman/ui/EditableRow";
import { NumberInput, TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { SettingValue } from "@maneman/ui/SettingRow";
import { errorText } from "@maneman/web-kit/refusal";
import type { ReactNode } from "react";
import { PriceRow, priceText } from "../components/PriceRow.tsx";
import { EDITING } from "../content/common.ts";
import { packagesCopy as copy } from "../content/packages.ts";
import { useAccess } from "../lib/access.ts";
import { HairSystems } from "./HairSystems.tsx";
import { PackageFoot } from "./PackageFoot.tsx";
import { packagesApi, type Package, type PackageChange, type Packages, type ProductCost } from "./packages-api.ts";
import { pricesApi } from "../prices/index.ts";
import { paiseFromRupees, rupees, rupeesTyped } from "@maneman/web-kit/money";
import styles from "./packages.module.css";

interface Changing {
  readonly code: string;
  readonly mayChange: boolean;
  readonly onChanged: (body: Packages) => void;
}

/** One change to the package: null once kept, else the words of why not. */
async function changed(changing: Changing, change: PackageChange): Promise<string | null> {
  const answer = await packagesApi.change(changing.code, change);
  if (!answer.ok) return errorText(copy.errors, answer);
  changing.onChanged(answer.body);
  return null;
}

/** A whole number on its own line: minutes, days or months. */
function FigureRow(props: {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly reads: (value: number) => string;
  readonly changing: Changing;
  readonly field: keyof PackageChange;
}) {
  return (
    <EditableRow<string>
      label={props.label}
      words={EDITING}
      mayChange={props.changing.mayChange}
      value={props.reads(props.value)}
      unit={props.unit}
      start={() => String(props.value)}
      save={(typed) => changed(props.changing, { [props.field]: Number(typed) })}
    >
      {(control, typed, type) => (
        <NumberInput
          {...control}
          width="figure"
          inputMode="numeric"
          value={typed}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      )}
    </EditableRow>
  );
}

/** A line of words on its own line: the name, or the line clients read under it. */
function WordsRow(props: {
  readonly label: string;
  readonly value: string;
  readonly shown: string;
  readonly maxLength: number;
  readonly changing: Changing;
  readonly field: "name" | "description";
}) {
  return (
    <EditableRow<string>
      label={props.label}
      words={EDITING}
      mayChange={props.changing.mayChange}
      value={props.shown}
      start={() => props.value}
      save={(typed) => changed(props.changing, { [props.field]: typed })}
    >
      {(control, typed, type) => (
        <TextInput
          {...control}
          width="area"
          maxLength={props.maxLength}
          value={typed}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      )}
    </EditableRow>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{props.title}</h3>
      {props.children}
    </section>
  );
}

/** What a first fit's or a replacement's hair system costs us, for the margin figures, from today. */
function CostRow(props: {
  readonly cost: ProductCost | undefined;
  readonly onCosts: (costs: readonly ProductCost[]) => void;
}) {
  const { cost } = props;
  const mayChange = useAccess().mayCall("POST /api/standard-costs");
  if (cost === undefined) return null;
  return (
    <EditableRow<string>
      label={copy.rows.cost}
      words={EDITING}
      mayChange={mayChange}
      value={cost.cost === null ? copy.rows.notSet : rupees(cost.cost)}
      start={() => (cost.cost === null ? "" : rupeesTyped(cost.cost))}
      save={async (typed) => {
        const answer = await pricesApi.setStandardCost({
          item: cost.item,
          tier: cost.tier,
          cost: paiseFromRupees(typed),
        });
        if (!answer.ok) return errorText(copy.errors, answer);
        props.onCosts(answer.body.products);
        return null;
      }}
    >
      {(control, typed, type) => (
        <NumberInput
          {...control}
          width="amount"
          inputMode="decimal"
          value={typed}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      )}
    </EditableRow>
  );
}

/** What a record's sections are given: the package, its writes, its prices' day and its costs. */
interface Parts {
  readonly chosen: Package;
  readonly changing: Changing;
  readonly today: string;
  readonly mayPrice: boolean;
  readonly refresh: () => Promise<void>;
  readonly costOf: (item: string) => ProductCost | undefined;
  readonly onCosts: (costs: readonly ProductCost[]) => void;
}

function FirstFit({ chosen, changing, costOf, onCosts }: Parts) {
  const from = chosen.first_fit.from;
  return (
    <Section title={copy.sections.firstFit}>
      <FigureRow
        label={copy.rows.length}
        value={chosen.first_fit.minutes}
        unit={copy.units.minutes}
        reads={copy.minutes}
        changing={changing}
        field="first_fit_minutes"
      />
      <SettingValue
        label={copy.rows.firstFitPrice}
        value={from === null ? copy.unpriced : copy.rows.firstFitFrom(priceText(from))}
      />
      <CostRow cost={costOf("first_fit")} onCosts={onCosts} />
    </Section>
  );
}

function ServiceVisit({ chosen, changing, today, mayPrice, refresh }: Parts) {
  return (
    <Section title={copy.sections.service}>
      <FigureRow
        label={copy.rows.length}
        value={chosen.service.minutes}
        unit={copy.units.minutes}
        reads={copy.minutes}
        changing={changing}
        field="service_minutes"
      />
      <FigureRow
        label={copy.rows.every}
        value={chosen.service.every_days}
        unit={copy.units.days}
        reads={copy.days}
        changing={changing}
        field="service_every_days"
      />
      <PriceRow
        label={copy.rows.price}
        item="service"
        tier={chosen.code}
        prices={chosen.service.prices}
        today={today}
        mayChange={mayPrice}
        onSaved={refresh}
        unpriced={copy.unpriced}
      />
    </Section>
  );
}

function Replacement({ chosen, changing, today, mayPrice, refresh, costOf, onCosts }: Parts) {
  const total = chosen.replacement.total;
  return (
    <Section title={copy.sections.replacement}>
      <FigureRow
        label={copy.rows.length}
        value={chosen.replacement.minutes}
        unit={copy.units.minutes}
        reads={copy.minutes}
        changing={changing}
        field="replacement_minutes"
      />
      <FigureRow
        label={copy.rows.after}
        value={chosen.replacement.after_months}
        unit={copy.units.months}
        reads={copy.months}
        changing={changing}
        field="replace_after_months"
      />
      <PriceRow
        label={copy.rows.price}
        item="replacement"
        tier={chosen.code}
        prices={chosen.replacement.prices}
        today={today}
        mayChange={mayPrice}
        onSaved={refresh}
        unpriced={copy.unpriced}
      />
      <SettingValue label={copy.rows.total} value={total === null ? copy.unpriced : priceText(total)} />
      <CostRow cost={costOf("replacement")} onCosts={onCosts} />
    </Section>
  );
}

export function PackageRecord(props: {
  readonly panelId: string;
  readonly packages: Packages;
  readonly chosen: Package;
  readonly onChanged: (body: Packages) => void;
  readonly refresh: () => Promise<void>;
  readonly onGone: () => void;
  /** What each product costs us; empty for a person who may not read it. */
  readonly costs: readonly ProductCost[];
  readonly onCosts: (costs: readonly ProductCost[]) => void;
}) {
  const { chosen, packages } = props;
  const access = useAccess();
  const changing: Changing = {
    code: chosen.code,
    mayChange: access.mayCall("PATCH /api/packages/{code}"),
    onChanged: props.onChanged,
  };
  const parts: Parts = {
    chosen,
    changing,
    today: packages.today,
    mayPrice: access.mayCall("POST /api/prices"),
    refresh: props.refresh,
    costOf: (item) => props.costs.find((each) => each.item === item && each.tier === chosen.code),
    onCosts: props.onCosts,
  };
  return (
    <Panel id={props.panelId} titleId={`package-${chosen.code}`} title={chosen.name} opened>
      <Section title={copy.sections.package}>
        <WordsRow
          label={copy.rows.name}
          value={chosen.name}
          shown={chosen.name}
          maxLength={46}
          changing={changing}
          field="name"
        />
        <WordsRow
          label={copy.rows.description}
          value={chosen.description ?? ""}
          shown={chosen.description ?? copy.rows.noDescription}
          maxLength={packages.max_description}
          changing={changing}
          field="description"
        />
      </Section>
      <FirstFit {...parts} />
      <ServiceVisit {...parts} />
      <Replacement {...parts} />
      <Section title={copy.sections.hairSystems}>
        <HairSystems chosen={chosen} today={packages.today} refresh={props.refresh} />
      </Section>
      <PackageFoot
        chosen={chosen}
        packages={packages}
        onChanged={props.onChanged}
        refresh={props.refresh}
        onGone={props.onGone}
      />
    </Panel>
  );
}
