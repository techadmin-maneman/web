// Each item's count class (docs/decisions/0185-cycle-counts.md): its kind's own, a hair system weekly and the rest
// quarterly, or the one ops set.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { Field, Select } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import { Refusal } from "../components/Refusal.tsx";

export type CountTasks = paths["/api/count-tasks"]["get"]["responses"][200]["content"]["application/json"];
type CountClass = CountTasks["classes"][number]["count_class"];

const CLASSES: readonly CountClass[] = ["weekly", "monthly", "quarterly"];
const OWN = "";

export function CountClasses({
  countTasks,
  onChanged,
}: {
  countTasks: CountTasks;
  onChanged: (countTasks: CountTasks) => void;
}) {
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const change = async (code: string, chosen: string) => {
    const answer = await client.post("/api/consumables/{code}/count-class", {
      path: { code },
      body: { count_class: chosen === OWN ? null : (chosen as CountClass) },
    });
    if (answer.ok) {
      onChanged(answer.body);
      setSaid(copy.classSaid);
      setFailure(null);
    } else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <Panel titleId="count-classes" title={copy.classesTitle}>
      <p className={form.note}>{copy.classesNote}</p>
      <Table className={form.table}>
        <thead>
          <tr>
            {copy.classColumns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {countTasks.classes.map((item) => {
            const own = item.hair_system ? "weekly" : "quarterly";
            return (
              <tr key={item.consumable_code}>
                <th scope="row" className={form.rowHead}>
                  {item.name}
                </th>
                <td>
                  <Field label={copy.classLabel(item.name)} className={form.field}>
                    {(control) => (
                      <Select
                        {...control}
                        className={form.choiceBox}
                        value={item.set ? item.count_class : OWN}
                        onChange={(event) => void change(item.consumable_code, event.target.value)}
                      >
                        <option value={OWN}>{copy.ownClass(copy.classes[own])}</option>
                        {CLASSES.map((each) => (
                          <option key={each} value={each}>
                            {copy.classes[each]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
    </Panel>
  );
}
