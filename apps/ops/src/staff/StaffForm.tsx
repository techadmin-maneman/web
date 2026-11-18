// Adding a member of staff: their sign-in email and what they may do, a job's grants at once (src/policy/role-presets.ts)
// over one place, or one department chosen by hand; more are added from their record. Someone already listed is
// changed from their record, never added twice, as saving would replace their grants whole. They sign in through the
// console's Google group, which the form reminds whoever adds them.

import { ROLE_PRESETS, type RolePreset } from "@rules/policy/role-presets.ts";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { useState } from "react";
import { type StaffGrant, type StaffList } from "../api.ts";
import { AddForm } from "@maneman/ui/AddForm";
import form from "@maneman/ui/forms.module.css";
import { settings } from "../content/settings.ts";
import { alreadyListed, whereOf, whereValue } from "../lib/grants.ts";
import { GrantBoxes, WhereChoice } from "./StaffRecord.tsx";
import styles from "./staff.module.css";
import { staffApi } from "./staff-api.ts";

const copy = settings.staff;

const FIRST_GRANT: StaffGrant = { department: "operations", level: "view", geography: "national", place: null };

type Role = RolePreset | "one";

const ROLES = Object.keys(copy.form.roles) as readonly Role[];

/** The grants the role gives, over the place chosen; one department's alone where none is chosen. */
const grantsOf = (role: Role, grant: StaffGrant): StaffGrant[] =>
  role === "one"
    ? [grant]
    : ROLE_PRESETS[role].map((each) => ({ ...each, geography: grant.geography, place: grant.place }));

function RoleChoice({ role, roles, onChange }: { role: Role; roles: readonly Role[]; onChange: (role: Role) => void }) {
  return (
    <Field label={copy.form.role} className={form.field}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={role}
          onChange={(event) => {
            onChange(roles.find((each) => each === event.target.value) ?? role);
          }}
        >
          {roles.map((each) => (
            <option key={each} value={each}>
              {copy.form.roles[each]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function AddPerson(props: {
  readonly staff: StaffList;
  readonly onAdded: (staff: StaffList) => void;
  readonly onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("one");
  const [grant, setGrant] = useState<StaffGrant>(FIRST_GRANT);
  const listed = alreadyListed(props.staff.people, email);
  // A zonal head is a zone's, so offered only where there is one, and given the first until another is chosen.
  const firstZone = props.staff.zones[0]?.name ?? null;
  const roles = ROLES.filter((each) => each !== "zonal_head" || firstZone !== null);
  const chooseRole = (chosen: Role) => {
    setRole(chosen);
    if (chosen === "zonal_head" && grant.geography !== "zone")
      setGrant({ ...grant, geography: "zone", place: firstZone });
  };
  return (
    <AddForm
      title={copy.form.addTitle}
      words={copy.form}
      errors={copy.errors}
      boxes={["email", "department", "level", "place"]}
      send={() =>
        listed
          ? Promise.resolve({ ok: false as const, code: "already_listed" })
          : staffApi.saveStaff({ email: email.trim(), active: true, grants: grantsOf(role, grant) })
      }
      onAdded={props.onAdded}
      onCancel={props.onCancel}
    >
      <Note>{copy.form.group}</Note>
      <div className={form.fields}>
        <Field
          label={copy.form.email}
          className={form.field}
          box="email"
          error={listed ? copy.errors.already_listed : null}
        >
          {(control) => (
            <TextInput
              {...control}
              width="area"
              type="email"
              autoComplete="off"
              maxLength={254}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          )}
        </Field>
        <RoleChoice role={role} roles={roles} onChange={chooseRole} />
        {role === "one" ? (
          <GrantBoxes staff={props.staff} grant={grant} onChange={setGrant} />
        ) : (
          <>
            <ul className={styles.roleGrants} aria-label={copy.form.roles[role]}>
              {ROLE_PRESETS[role].map((each) => (
                <li key={each.department}>
                  {copy.form.roleGrant(copy.departments[each.department], copy.levels[each.level])}
                </li>
              ))}
            </ul>
            <WhereChoice
              staff={props.staff}
              zonesOnly={role === "zonal_head"}
              value={whereValue(grant)}
              onChange={(value) => {
                setGrant({ ...grant, ...whereOf(value) });
              }}
            />
          </>
        )}
      </div>
    </AddForm>
  );
}
