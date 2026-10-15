// Retiring a consumable from a day, or restoring one retired
// (docs/decisions/0087-consumables-and-stock.md). The technician app stops
// offering it from that day; nothing already recorded moves, and neither does
// its stock. The check says so before anything is sent (ADR 0071).

import { CheckLine } from "../components/CheckPanel.tsx";
import { Field, DateInput, Fieldset } from "@maneman/ui/Field";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type Consumable, type Consumables } from "../api.ts";
import { settings } from "../content/settings.ts";
import form from "../components/forms.module.css";
import { ActionCheck, SettingForm, sentOf, useSteps } from "../settings/index.ts";
import { itemsApi } from "./items-api.ts";

const copy = settings.consumables;
const words = copy.retiring;

interface Props {
  readonly consumable: Consumable;
  readonly onSaved: (consumables: Consumables, said: string) => void;
  readonly onCancel: () => void;
}

/** A retired consumable offered again: nothing to fill in, so the question is all there is. */
export function Restoring({ consumable, onSaved, onCancel }: Props) {
  return (
    <Fieldset className={form.group} legend={copy.restoreLabel(consumable.name)} legendLook="title">
      <ActionCheck
        label={copy.restore}
        question={words.restore(consumable.name)}
        send={async () => sentOf(await itemsApi.restoreConsumable(consumable.code), (consumables) => ({ consumables }))}
        onDone={(sent) => {
          onSaved(sent.consumables, words.done);
        }}
        errors={copy.errors}
        onCancel={onCancel}
      />
    </Fieldset>
  );
}

/** An offered consumable retired from a day, which the check names before anything is sent. */
export function Retiring({ consumable, today, onSaved, onCancel }: Props & { readonly today: string }) {
  const [from, setFrom] = useState(today);
  const steps = useSteps(
    async () => sentOf(await itemsApi.retireConsumable(consumable.code, from), (consumables) => ({ consumables })),
    (sent) => {
      onSaved(sent.consumables, words.done);
    },
  );
  return (
    <SettingForm
      title={words.title(consumable.name)}
      steps={steps}
      ready={from !== ""}
      errors={copy.errors}
      onCancel={onCancel}
      boxes={["from"]}
      checking={<CheckLine>{words.question(consumable.name, from === "" ? "" : longDate(from))}</CheckLine>}
    >
      <div className={form.fields}>
        <Field label={words.from} className={form.field} box="from">
          {(control) => (
            <DateInput
              {...control}
              width="date"
              min={today}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
      </div>
    </SettingForm>
  );
}
