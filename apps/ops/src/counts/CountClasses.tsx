// Each item's count class (docs/decisions/0185-cycle-counts.md): its kind's own, a hair system weekly and the rest
// quarterly, or the one ops set. Read beside the counts as the redesign draws them; changed in a drawer, for those
// who may.

import { Toast } from "@maneman/ui/Toast";
import type { Success } from "@maneman/web-kit/api";
import { Panel } from "@maneman/ui/Panel";
import { Select } from "@maneman/ui/Field";
import { SettingRow } from "@maneman/ui/SettingRow";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { paths } from "../api-schema.ts";
import form from "@maneman/ui/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import { Refusal } from "@maneman/ui/Refusal";
import { countsApi } from "./counts-api.ts";

export type CountTasks = Success<paths["/api/count-tasks"]["get"]>;
type CountClass = CountTasks["classes"][number]["count_class"];

const CLASSES: readonly CountClass[] = ["weekly", "monthly", "quarterly"];
const OWN = "";

/** The class an item's kind takes until ops set one: a hair system weekly, the rest quarterly. */
const kindsOwn = (item: CountTasks["classes"][number]): CountClass => (item.hair_system ? "weekly" : "quarterly");

/** An item's class in words: the one ops set, else its kind's. */
const classOf = (item: CountTasks["classes"][number]): string =>
  copy.classes[item.set ? item.count_class : kindsOwn(item)];

/** Each item's class, a row each; Change, for those who may, opens them to be set. */
export function CountClasses(props: {
  countTasks: CountTasks;
  mayChange: boolean;
  onChanged: (countTasks: CountTasks) => void;
}) {
  const { countTasks } = props;
  return (
    <Panel
      titleId="count-classes"
      title={copy.classesTitle}
      actions={
        props.mayChange && (
          <DrawerButton label={copy.change} title={copy.classesTitle}>
            {() => <ClassChoices countTasks={countTasks} onChanged={props.onChanged} />}
          </DrawerButton>
        )
      }
    >
      <DescriptionList
        layout="ends"
        items={countTasks.classes.map((item) => ({ term: item.name, details: classOf(item) }))}
      />
    </Panel>
  );
}

function ClassChoices({
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
    <>
      {countTasks.classes.map((item) => {
        const own = kindsOwn(item);
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
      {said !== null && <Toast>{said}</Toast>}
      {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
    </>
  );
}
