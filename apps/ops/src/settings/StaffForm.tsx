// Adding a member of staff, or changing their grants and whether they are let in. The whole list of grants is sent
// and replaces theirs; the check names each grant given or taken away before anything is saved.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Checkbox, Fieldset, Label, Select, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { api, type StaffBook, type StaffGrant, type StaffPerson, type StaffSave } from "../api.ts";
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
import styles from "../components/forms.module.css";
import staffStyles from "./staff.module.css";
import { SettingForm, sentOf, useSteps } from "./SettingForm.tsx";

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
  index: number;
  grant: StaffGrant;
  staff: StaffBook;
  onChange: (grant: StaffGrant) => void;
  onRemove: () => void;
}) {
  const { index, grant, staff, onChange, onRemove } = props;
  const id = (box: string) => `staff-grant-${String(index)}-${box}`;
  return (
    <li className={staffStyles.grantRow}>
      <div className={styles.field}>
        <Label htmlFor={id("department")}>{copy.form.department}</Label>
        <Select
          id={id("department")}
          className={styles.select}
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
      </div>
      <div className={styles.field}>
        <Label htmlFor={id("level")}>{copy.form.level}</Label>
        <Select
          id={id("level")}
          className={styles.select}
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
      </div>
      <div className={styles.field}>
        <Label htmlFor={id("place")}>{copy.form.place}</Label>
        <Select
          id={id("place")}
          className={styles.select}
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
      </div>
      <Button
        variant="outline"
        size="small"
        className={styles.quiet}
        aria-label={copy.form.removeGrantLabel(grantWords(grant))}
        onClick={onRemove}
      >
        {copy.form.removeGrant}
      </Button>
    </li>
  );
}

export function StaffForm(props: {
  staff: StaffBook;
  person: StaffPerson | null;
  onSaved: (staff: StaffBook) => void;
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
        <p className={styles.checkLine} key={line}>
          {line}
        </p>
      ))}
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <Label htmlFor="staff-email">{copy.form.email}</Label>
          <TextInput
            id="staff-email"
            className={styles.text}
            type="email"
            autoComplete="off"
            maxLength={254}
            disabled={person !== null}
            value={draft.email}
            onChange={(event) => {
              edit({ email: event.target.value });
            }}
          />
        </div>
      </div>
      <Checkbox
        className={styles.once}
        label={copy.form.letIn}
        checked={draft.active}
        onChange={(event) => {
          edit({ active: event.target.checked });
        }}
      />
      <Fieldset className={styles.choices} legend={copy.form.access}>
        <ul className={staffStyles.grants}>
          {draft.grants.map((grant, index) => (
            <GrantRow
              key={index}
              index={index}
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
      <div className={styles.actions}>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          onClick={() => {
            edit({ grants: [...draft.grants, NEW_GRANT] });
          }}
        >
          {copy.form.addGrant}
        </Button>
      </div>
      {listed && (
        <InlineMessage tone="error" className={styles.error}>
          {errorText(copy.errors, { code: "already_listed" })}
        </InlineMessage>
      )}
    </SettingForm>
  );
}
