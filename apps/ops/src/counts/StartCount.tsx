// A count of one item at one place, started now rather than waiting for the morning's tasks
// (docs/decisions/0185-cycle-counts.md).

import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { boxError, formError, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import form from "../components/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import type { CountTasks } from "./CountClasses.tsx";
import { FormRefusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { countsApi } from "./counts-api.ts";

export function StartCount({ countTasks, onStarted }: { countTasks: CountTasks; onStarted: (id: string) => void }) {
  const [place, setPlace] = useState("");
  const [item, setItem] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const start = async () => {
    const answer = await countsApi.startCount({ place_id: place, consumable_code: item });
    if (answer.ok) {
      setFailure(null);
      onStarted(answer.body.task.id);
    } else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <Panel titleId="count-now" title={copy.startTitle}>
      <div className={form.group}>
        <Field label={copy.place} className={form.field} error={boxError(copy.errors, failure, "place_id")}>
          {(control) => (
            <Select
              {...control}
              value={place}
              onChange={(event) => {
                setPlace(event.target.value);
              }}
            >
              <option value="">{copy.choose}</option>
              {countTasks.places.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={copy.item} className={form.field} error={boxError(copy.errors, failure, "consumable_code")}>
          {(control) => (
            <Select
              {...control}
              value={item}
              onChange={(event) => {
                setItem(event.target.value);
              }}
            >
              <option value="">{copy.choose}</option>
              {countTasks.classes.map((each) => (
                <option key={each.consumable_code} value={each.consumable_code}>
                  {each.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <FormActions>
          <Button variant="primary" size="small" disabled={place === "" || item === ""} onClick={() => void start()}>
            {copy.start}
          </Button>
        </FormActions>
      </div>
      <FormRefusal className={form.error} said={formError(copy.errors, failure, ["place_id", "consumable_code"])} />
    </Panel>
  );
}
