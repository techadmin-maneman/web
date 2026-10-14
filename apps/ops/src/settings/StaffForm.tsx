// Adding a member of staff, or changing their grants and whether they are let in. The whole list of grants is sent
// and replaces theirs; the check names each grant given or taken away before anything is saved.

import { Field, Checkbox, Fieldset, Select, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { api, type StaffList, type StaffGrant, type StaffPerson, type StaffSave } from "../api.ts";
import { settings } from "../content/settings.ts";
import { review } from "../content/common.ts";
import {
  alreadyListed,
  departmentOf,
  DEPARTMENTS,
  grantWords,
  levelOf,
  LEVELS,
  sameGrant,
  whereOf,
  whereValue,
} from "../lib/grants.ts";
import form from "../components/forms.module.css";
import styles from "./staff.module.css";
import { SettingForm, sentOf, useSteps } from "./SettingForm.tsx";
import { Refusal } from "../components/Refusal.tsx";

const copy = settings.staff;

interface Draft {
  readonly email: string;
  readonly active: boolean;
  readonly grants: readonly StaffGrant[];
}

const NEW_GRANT: StaffGrant = { department: "operations", level: "view", geography: "national", place: null };

const draftOf = (person: StaffPerson | null): Draft =>
  person === null
    ? { email: "", active: true, grants: [NEW_GRANT] }
    : { email: person.email, active: person.active, grants: person.grants };

/** What the check says the change does: who is added, switched on or off, and each grant given or taken away. */
function checkLines(person: StaffPerson | null, sent: StaffSave): string[] {
  const before = person?.grants ?? [];
  const lines: string[] = [];
  if (person === null) lines.push(copy.confirm.adds(sent.email));
  if (person !== null && person.active !== sent.active) {
    lines.push(sent.active ? copy.confirm.letsIn : copy.confirm.switchesOff);
  }
  for (const grant of sent.grants) {
    if (!before.some((held) => sameGrant(held, grant))) lines.push(copy.confirm.gives(grantWords(grant)));
  }
  for (const grant of before) {
    if (!sent.grants.some((kept) => sameGrant(kept, grant))) lines.push(copy.confirm.takes(grantWords(grant)));
  }
  return lines;
}

function GrantRow(props: {
  grant: StaffGrant;
  staff: StaffList;
  onChange: (grant: StaffGrant) => void;
  onRemove: () => void;
}) {
  const { grant, staff, onChange, onRemove } = props;
  return (
    <li className={styles.grantRow}>
      <Field label={copy.form.department} className={form.field}>
        {(control) => (
          <Select
            {...control}
            className={form.select}
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
      <Field label={copy.form.level} className={form.field}>
        {(control) => (
          <Select
            {...control}
            className={form.select}
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
      <Field label={copy.form.place} className={form.field}>
        {(control) => (
          <Select
            {...control}
            className={form.select}
            value={whereValue(grant)}
            onChange={(event) => {
              onChange({ ...grant, ...whereOf(event.target.value) });
            }}
          >
            <option value="national">{copy.national}</option>
            <optgroup label={copy.zones}>
              {staff.zones.map((zone) => (
                <option key={zone.name} value={whereValue({ geography: "zone", place: zone.name })}>
                  {copy.zone(zone.name)}
                </option>
              ))}
            </optgroup>
            <optgroup label={copy.cities}>
              {staff.cities.map((city) => (
                <option key={city} value={whereValue({ geography: "city", place: city })}>
                  {city}
                </option>
              ))}
            </optgroup>
          </Select>
        )}
      </Field>
      <Button
        variant="outline"
        size="small"
        className={form.quiet}
        aria-label={copy.form.removeGrantLabel(grantWords(grant))}
        onClick={onRemove}
      >
        {copy.form.removeGrant}
      </Button>
    </li>
  );
}

export function StaffForm(props: {
  staff: StaffList;
  person: StaffPerson | null;
  onSaved: (staff: StaffList) => void;
  onCancel: () => void;
}) {
  const { staff, person, onSaved, onCancel } = props;
  const [draft, setDraft] = useState<Draft>(draftOf(person));
  const sent: StaffSave = { email: draft.email.trim(), active: draft.active, grants: [...draft.grants] };
  const steps = useSteps(
    async () => sentOf(await api.saveStaff(sent), (next) => ({ next })),
    (done) => {
      onSaved(done.next);
    },
  );
  // Someone already on the list is changed from their own row, never added twice.
  const listed = person === null && alreadyListed(staff.people, draft.email);

  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    steps.edit();
  };
  const editGrant = (index: number, grant: StaffGrant) => {
    edit({ grants: draft.grants.map((each, at) => (at === index ? grant : each)) });
  };
  const lines = steps.step === "editing" ? [] : checkLines(person, sent);

  return (
    <SettingForm
      title={person === null ? copy.form.addTitle : copy.form.changeTitle(person.email)}
      steps={steps}
      ready={draft.email.trim() !== "" && !listed}
      errors={copy.errors}
      onCancel={onCancel}
      sendable={lines.length > 0}
      checking={(lines.length === 0 ? [review.nothing] : lines).map((line) => (
        <p className={form.checkLine} key={line}>
          {line}
        </p>
      ))}
    >
      <div className={form.fields}>
        <Field label={copy.form.email} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              className={form.text}
              type="email"
              autoComplete="off"
              maxLength={254}
              disabled={person !== null}
              value={draft.email}
              onChange={(event) => {
                edit({ email: event.target.value });
              }}
            />
          )}
        </Field>
      </div>
      <Checkbox
        className={form.once}
        label={copy.form.letIn}
        checked={draft.active}
        onChange={(event) => {
          edit({ active: event.target.checked });
        }}
      />
      <Fieldset className={form.choices} legend={copy.form.access}>
        <ul className={styles.grants}>
          {draft.grants.map((grant, index) => (
            <GrantRow
              key={index}
              grant={grant}
              staff={staff}
              onChange={(changed) => {
                editGrant(index, changed);
              }}
              onRemove={() => {
                edit({ grants: draft.grants.filter((_, at) => at !== index) });
              }}
            />
          ))}
        </ul>
      </Fieldset>
      <div className={form.actions}>
        <Button
          variant="outline"
          size="small"
          className={form.quiet}
          onClick={() => {
            edit({ grants: [...draft.grants, NEW_GRANT] });
          }}
        >
          {copy.form.addGrant}
        </Button>
      </div>
      {listed && <Refusal className={form.error} said={errorText(copy.errors, { code: "already_listed" })} />}
    </SettingForm>
  );
}
