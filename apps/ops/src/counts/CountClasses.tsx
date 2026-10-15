// Each item's count class (docs/decisions/0185-cycle-counts.md): its kind's own, a hair system weekly and the rest
// quarterly, or the one ops set.

import type { Success } from "@maneman/web-kit/api";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { Select } from "@maneman/ui/Field";
import { SettingRow } from "@maneman/ui/SettingRow";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import { Refusal } from "../components/Refusal.tsx";
import { countsApi } from "./counts-api.ts";

export type CountTasks = Success<paths["/api/count-tasks"]["get"]>;
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
    const answer = await countsApi.setCountClass(code, { count_class: chosen === OWN ? null : (chosen as CountClass) });
    if (answer.ok) {
      onChanged(answer.body);
      setSaid(copy.classSaid);
      setFailure(null);
    } else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <Panel titleId="count-classes" title={copy.classesTitle}>
      {countTasks.classes.map((item) => {
        const own = item.hair_system ? "weekly" : "quarterly";
        return (
          <SettingRow key={item.consumable_code} label={item.name}>
            {(control) => (
              <Select
                {...control}
                width="choice"
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
          </SettingRow>
        );
      })}
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
    </Panel>
  );
}
