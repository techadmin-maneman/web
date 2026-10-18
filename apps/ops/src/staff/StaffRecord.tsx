// A member of staff's record: their sign-in email, whether they are let in, and each grant, its level changed where it
// reads; a level of none takes the grant away. A department is added beneath, and the person taken off the list at the
// foot. Every change sends their whole list of grants, which replaces theirs.

import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type StaffGrant, type StaffList, type StaffPerson } from "../api.ts";
import { AddForm } from "../components/AddForm.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { ChoiceRow, ReadRow } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import {
  departmentOf,
  DEPARTMENTS,
  levelOf,
  LEVELS,
  placeWords,
  sameGrant,
  whereOf,
  whereValue,
} from "../lib/grants.ts";
import { staffApi } from "./staff-api.ts";
import styles from "./staff.module.css";

const copy = settings.staff;

/** No grant, as the level box offers it: choosing it takes the grant away. */
const NONE = "none";

const NEW_GRANT: StaffGrant = { department: "operations", level: "view", geography: "national", place: null };

/** Where a grant reaches, as its box offers it: nationally, a zone, or a city. */
function WhereChoice(props: {
  readonly staff: StaffList;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field label={copy.form.place} className={form.field} box="place">
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          <option value="national">{copy.national}</option>
          <optgroup label={copy.zones}>
            {props.staff.zones.map((zone) => (
              <option key={zone.name} value={whereValue({ geography: "zone", place: zone.name })}>
                {copy.zone(zone.name)}
              </option>
            ))}
          </optgroup>
          <optgroup label={copy.cities}>
            {props.staff.cities.map((city) => (
              <option key={city} value={whereValue({ geography: "city", place: city })}>
                {city}
              </option>
            ))}
          </optgroup>
        </Select>
      )}
    </Field>
  );
}

/** A department, its level and where it reaches: a person's first grant, or one more for someone listed. */
export function GrantBoxes(props: {
  readonly staff: StaffList;
  readonly grant: StaffGrant;
  readonly onChange: (grant: StaffGrant) => void;
}) {
  const { grant, onChange } = props;
  return (
    <>
      <Field label={copy.form.department} className={form.field} box="department">
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={grant.department}
            onChange={(event) => {
              onChange({ ...grant, department: departmentOf(event.target.value, grant.department) });
            }}
          >
            {DEPARTMENTS.map((department) => (
              <option key={department} value={department}>
                {copy.departments[department]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={copy.form.level} className={form.field} box="level">
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={grant.level}
            onChange={(event) => {
              onChange({ ...grant, level: levelOf(event.target.value, grant.level) });
            }}
          >
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {copy.levels[level]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <WhereChoice
        staff={props.staff}
        value={whereValue(grant)}
        onChange={(value) => {
          onChange({ ...grant, ...whereOf(value) });
        }}
      />
    </>
  );
}

/** One more department for someone listed, beneath their grants. */
function AddGrant(props: {
  readonly staff: StaffList;
  readonly save: (grants: readonly StaffGrant[]) => ReturnType<typeof staffApi.saveStaff>;
  readonly grants: readonly StaffGrant[];
  readonly onDone: () => void;
}) {
  const [grant, setGrant] = useState<StaffGrant>(NEW_GRANT);
  return (
    <AddForm
      title={copy.form.addGrant}
      words={copy.form}
      errors={copy.errors}
      boxes={["department", "level", "place"]}
      send={() => props.save([...props.grants, grant])}
      onAdded={props.onDone}
      onCancel={props.onDone}
    >
      <div className={form.fields}>
        <GrantBoxes staff={props.staff} grant={grant} onChange={setGrant} />
      </div>
    </AddForm>
  );
}

/** Another department for someone listed: its button, then its boxes in place. */
function MoreGrants(props: {
  readonly staff: StaffList;
  readonly grants: readonly StaffGrant[];
  readonly save: (grants: readonly StaffGrant[]) => ReturnType<typeof staffApi.saveStaff>;
}) {
  const [adding, setAdding] = useState(false);
  if (adding) {
    return (
      <AddGrant
        staff={props.staff}
        grants={props.grants}
        save={props.save}
        onDone={() => {
          setAdding(false);
        }}
      />
    );
  }
  return (
    <div className={styles.addGrant}>
      <Button
        variant="outline"
        size="small"
        narrow
        onClick={() => {
          setAdding(true);
        }}
      >
        {copy.form.addGrant}
      </Button>
    </div>
  );
}

export function StaffRecord(props: {
  readonly staff: StaffList;
  readonly person: StaffPerson;
  readonly mayChange: boolean;
  readonly mayRemove: boolean;
  readonly onSaved: (staff: StaffList) => void;
  readonly onRemoved: (staff: StaffList) => void;
}) {
  const { staff, person, mayChange, onSaved } = props;
  const send = async (grants: readonly StaffGrant[], active = person.active) => {
    const answer = await staffApi.saveStaff({ email: person.email, active, grants: [...grants] });
    if (answer.ok) onSaved(answer.body);
    return answer;
  };
  const said = async (grants: readonly StaffGrant[], active?: boolean) => {
    const answer = await send(grants, active);
    return answer.ok ? null : errorText(copy.errors, answer);
  };
  const levels = [...LEVELS.map((level) => [level, copy.levels[level]] as const), [NONE, copy.form.noAccess] as const];
  return (
    <>
      <div className={form.record}>
        <ReadRow label={copy.form.email} value={person.email} />
        <ChoiceRow
          label={copy.columns.state}
          value={person.active ? "active" : "off"}
          choices={[
            ["active", copy.active],
            ["off", copy.inactive],
          ]}
          mayChange={mayChange}
          save={(chosen) => said(person.grants, chosen === "active")}
        />
        {person.grants.length === 0 && <ReadRow label={copy.form.access} value={copy.noAccess} />}
        {person.grants.map((grant) => (
          <ChoiceRow
            key={`${grant.department}/${whereValue(grant)}`}
            label={copy.grantLabel(copy.departments[grant.department], placeWords(grant))}
            value={grant.level}
            choices={levels}
            mayChange={mayChange}
            save={(chosen) => {
              const kept = person.grants.filter((each) => !sameGrant(each, grant));
              const level = LEVELS.find((each) => each === chosen);
              return said(
                level === undefined ? kept : person.grants.map((each) => (each === grant ? { ...grant, level } : each)),
              );
            }}
          />
        ))}
      </div>
      {mayChange && <MoreGrants staff={staff} grants={person.grants} save={send} />}
      {props.mayRemove && (
        <div className={form.recordFoot}>
          <DeleteAction
            name={person.email}
            words={copy.removing}
            send={() => staffApi.deleteStaff(person.email)}
            refusal={(code) => errorText(copy.errors, { code })}
            onDeleted={props.onRemoved}
          />
        </div>
      )}
    </>
  );
}
