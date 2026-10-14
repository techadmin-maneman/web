// A count of one item at one place, started now rather than waiting for the morning's tasks
// (docs/decisions/0185-cycle-counts.md).

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { client } from "../api.ts";
import form from "../components/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import type { CountTasks } from "./CountClasses.tsx";

export function StartCount({ countTasks, onStarted }: { countTasks: CountTasks; onStarted: (id: string) => void }) {
  const [place, setPlace] = useState("");
  const [item, setItem] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const start = async () => {
    const answer = await client.post("/api/count-tasks", { body: { place_id: place, consumable_code: item } });
    if (answer.ok) {
      setFailure(null);
      onStarted(answer.body.task.id);
    } else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <Panel titleId="count-now" title={copy.startTitle}>
      <div className={form.group}>
        <Field label={copy.place} className={form.field}>
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
        <Field label={copy.item} className={form.field}>
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
        <div className={form.actions}>
          <Button variant="primary" size="small" disabled={place === "" || item === ""} onClick={() => void start()}>
            {copy.start}
          </Button>
        </div>
      </div>
      {failure !== null && (
        <InlineMessage tone="error" className={form.error}>
          {errorText(copy.errors, failure)}
        </InlineMessage>
      )}
    </Panel>
  );
}
