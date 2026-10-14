// Retiring a consumable from a day, or restoring one retired
// (docs/decisions/0087-consumables-and-stock.md). The technician app stops
// offering it from that day; nothing already recorded moves, and neither does
// its stock. The check says so before anything is sent (ADR 0071).

import { DateInput, Fieldset, Label } from "@maneman/ui/Field";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Consumable, type Consumables } from "../api.ts";
import { settings } from "../content/settings.ts";
import styles from "../components/forms.module.css";
import { ActionCheck, SettingForm, sentOf, useSteps } from "./SettingForm.tsx";

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
    <Fieldset className={styles.group} legend={copy.restoreLabel(consumable.name)} legendLook="title">
      <ActionCheck
        label={copy.restore}
        question={words.restore(consumable.name)}
        send={async () => sentOf(await api.restoreConsumable(consumable.code), (consumables) => ({ consumables }))}
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
    async () => sentOf(await api.retireConsumable(consumable.code, from), (consumables) => ({ consumables })),
    (sent) => {
      onSaved(sent.consumables, words.done);
    },
  );
  const id = `retire-${consumable.code}`;
  return (
    <SettingForm
      title={words.title(consumable.name)}
      steps={steps}
      ready={from !== ""}
      errors={copy.errors}
      onCancel={onCancel}
      checking={
        <p className={styles.checkLine}>{words.question(consumable.name, from === "" ? "" : longDate(from))}</p>
      }
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <Label htmlFor={id}>{words.from}</Label>
          <DateInput
            className={styles.date}
            id={id}
            min={today}
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              steps.edit();
            }}
          />
        </div>
      </div>
    </SettingForm>
  );
}
