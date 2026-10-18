// Settings · Consultation and fees (docs/decisions/0085-services-ops-can-edit.md): the consultation clients book, its
// name, the line they read under it, its length and its price, and the two late fees, each one figure for its kind.
// Every value changes where it reads (docs/decisions/0212-editing-in-place.md). A first fit, a service visit and a
// replacement are a package's, set in Settings · Packages (docs/decisions/0211-packages.md).

import { EditableRow } from "@maneman/ui/EditableRow";
import { NumberInput, TextInput } from "@maneman/ui/Field";
import { Stack } from "@maneman/ui/Layout";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { OpsService, ServiceCatalogue } from "../api.ts";
import { PriceRow } from "../components/PriceRow.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { EDITING } from "../content/common.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { rulePath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { pricesApi } from "./prices-api.ts";

const copy = settings.services;

type Answer = Awaited<ReturnType<typeof pricesApi.renameService>>;

/** A change's answer: null once kept, with the page following it, else the words of why not. */
function keptBy(answer: Answer, onChanged: (catalogue: ServiceCatalogue) => void): string | null {
  if (!answer.ok) return errorText(copy.errors, answer);
  onChanged(answer.body);
  return null;
}

function Consultation(props: {
  readonly service: OpsService;
  readonly today: string;
  readonly onChanged: (catalogue: ServiceCatalogue) => void;
  readonly refresh: () => Promise<void>;
}) {
  const { service, today } = props;
  const access = useAccess();
  const mayChange = access.mayCall("POST /api/services/{kind}/{tier}/name");
  const mayPrice = access.mayCall("POST /api/prices");
  const text = (field: "name" | "description", maxLength: number) => (
    <EditableRow<string>
      label={copy.rows[field]}
      words={EDITING}
      mayChange={mayChange}
      value={field === "name" ? service.name : (service.description ?? copy.rows.noDescription)}
      start={() => (field === "name" ? service.name : (service.description ?? ""))}
      save={async (typed) =>
        keptBy(
          field === "name"
            ? await pricesApi.renameService("consultation", service.tier, typed)
            : await pricesApi.describeService("consultation", service.tier, typed),
          props.onChanged,
        )
      }
    >
      {(control, typed, type) => (
        <TextInput
          {...control}
          width="area"
          maxLength={maxLength}
          value={typed}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      )}
    </EditableRow>
  );
  return (
    <>
      {text("name", 60)}
      {text("description", 160)}
      <EditableRow<string>
        label={copy.rows.length}
        words={EDITING}
        mayChange={mayChange}
        value={copy.minutes(service.minutes)}
        unit={copy.unit}
        start={() => String(service.minutes)}
        save={async (typed) =>
          keptBy(await pricesApi.setServiceLength("consultation", service.tier, Number(typed)), props.onChanged)
        }
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
      <PriceRow
        label={copy.rows.price}
        item="consultation"
        tier={service.tier}
        prices={service.prices}
        today={today}
        mayChange={mayPrice}
        onSaved={props.refresh}
        unpriced={copy.unpriced}
      />
    </>
  );
}

export function Services() {
  const [loaded, retry] = useLoad(pricesApi.services);
  /** The services after a change, so the page follows without reading it again. */
  const [shown, setShown] = useState<ServiceCatalogue | null>(null);
  const access = useAccess();
  const mayPrice = access.mayCall("POST /api/prices");
  const mayOpenRules = access.mayCall("GET /api/settings");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const current = shown ?? loaded.value;
  const refresh = async () => {
    const answer = await pricesApi.services();
    if (answer.ok) setShown(answer.body);
  };
  const consultations = current.services.filter((service) => service.kind === "consultation");

  return (
    <Stack>
      {consultations.map((service) => (
        <Panel key={service.tier} titleId={`consultation-${service.tier}`} title={copy.consultation}>
          <Consultation service={service} today={current.today} onChanged={setShown} refresh={refresh} />
        </Panel>
      ))}
      <Panel titleId="late-fees" title={copy.lateFees}>
        {mayOpenRules && (
          <Note>
            <OpsLink to={rulePath("late_change_charge")}>{copy.lateFeeRule}</OpsLink>
          </Note>
        )}
        {current.late_fees.map((fee) => (
          <div key={fee.item}>
            <PriceRow
              label={copy.lateFeeNames[fee.item]}
              item={fee.item}
              tier="standard"
              prices={fee.prices}
              today={current.today}
              mayChange={mayPrice}
              onSaved={refresh}
              unpriced={copy.unpriced}
            />
          </div>
        ))}
      </Panel>
    </Stack>
  );
}
