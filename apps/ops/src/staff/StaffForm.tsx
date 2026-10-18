// Adding a member of staff: their sign-in email and their first grant; more are added from their record. Someone
// already listed is changed from their record, never added twice, as saving would replace their grants whole.

import { Field, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { type StaffGrant, type StaffList } from "../api.ts";
import { AddForm } from "../components/AddForm.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import { alreadyListed } from "../lib/grants.ts";
import { GrantBoxes } from "./StaffRecord.tsx";
import { staffApi } from "./staff-api.ts";

const copy = settings.staff;

const FIRST_GRANT: StaffGrant = { department: "operations", level: "view", geography: "national", place: null };

export function AddPerson(props: {
  readonly staff: StaffList;
  readonly onAdded: (staff: StaffList) => void;
  readonly onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [grant, setGrant] = useState<StaffGrant>(FIRST_GRANT);
  const listed = alreadyListed(props.staff.people, email);
  return (
    <AddForm
      title={copy.form.addTitle}
      words={copy.form}
      errors={copy.errors}
      boxes={["email", "department", "level", "place"]}
      send={() =>
        listed
          ? Promise.resolve({ ok: false as const, code: "already_listed" })
          : staffApi.saveStaff({ email: email.trim(), active: true, grants: [grant] })
      }
      onAdded={props.onAdded}
      onCancel={props.onCancel}
    >
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
        <GrantBoxes staff={props.staff} grant={grant} onChange={setGrant} />
      </div>
    </AddForm>
  );
}
