// Adding a member of staff, or changing their grants and whether they are let in. The whole list of grants is sent
// and replaces theirs; the check names each grant given or taken away before anything is saved.

import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { api, type StaffBook, type StaffGrant, type StaffPerson, type StaffSave } from "../api.ts";
import { settings } from "../content.ts";
import { CheckPanel } from "./CheckPanel.tsx";
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
} from "./grants.ts";
import { refusalOf, type Failure } from "./refusal.ts";
import styles from "./settings.module.css";
import staffStyles from "./staff.module.css";

const copy = settings.staff;

interface Draft {
  readonly email: string;
  readonly active: boolean;
  readonly grants: readonly StaffGrant[];
}

type Step =
  | { readonly step: "editing" }
  | { readonly step: "checking" | "sending"; readonly sent: StaffSave }
  | { readonly step: "failed"; readonly failure: Failure };

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
  book: StaffBook;
  onChange: (grant: StaffGrant) => void;
  onRemove: () => void;
}) {
  const { index, grant, book, onChange, onRemove } = props;
  const id = (box: string) => `staff-grant-${String(index)}-${box}`;
  return (
    <li className={staffStyles.grantRow}>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={id("department")}>
          {copy.form.department}
        </label>
        <select
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
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={id("level")}>
          {copy.form.level}
        </label>
        <select
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
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={id("place")}>
          {copy.form.place}
        </label>
        <select
          id={id("place")}
          className={styles.select}
          value={whereValue(grant)}
          onChange={(event) => {
            onChange({ ...grant, ...whereOf(event.target.value) });
          }}
        >
          <option value="national">{copy.national}</option>
          <optgroup label={copy.zones}>
            {book.zones.map((zone) => (
              <option key={zone.name} value={whereValue({ geography: "zone", place: zone.name })}>
                {copy.zone(zone.name)}
              </option>
            ))}
          </optgroup>
          <optgroup label={copy.cities}>
            {book.cities.map((city) => (
              <option key={city} value={whereValue({ geography: "city", place: city })}>
                {city}
              </option>
            ))}
          </optgroup>
        </select>
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
  book: StaffBook;
  person: StaffPerson | null;
  onSaved: (book: StaffBook) => void;
  onCancel: () => void;
}) {
  const { book, person, onSaved, onCancel } = props;
  const [draft, setDraft] = useState<Draft>(draftOf(person));
  const [step, setStep] = useState<Step>({ step: "editing" });

  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    setStep({ step: "editing" });
  };
  const editGrant = (index: number, grant: StaffGrant) => {
    edit({ grants: draft.grants.map((each, at) => (at === index ? grant : each)) });
  };

  const send = async (sent: StaffSave) => {
    setStep({ step: "sending", sent });
    const answer = await api.saveStaff(sent);
    if (!answer.ok) {
      setStep({ step: "failed", failure: { code: answer.code, fields: answer.fields } });
      return;
    }
    onSaved(answer.body);
  };

  if (step.step === "checking" || step.step === "sending") {
    const lines = checkLines(person, step.sent);
    return (
      <div className={styles.group}>
        <CheckPanel
          title={copy.confirm.title}
          lines={lines.length === 0 ? [copy.confirm.nothing] : lines}
          ready={lines.length > 0}
          send={copy.confirm.send}
          sending={copy.confirm.sending}
          back={copy.confirm.back}
          busy={step.step === "sending"}
          onSend={() => void send(step.sent)}
          onBack={() => {
            setStep({ step: "editing" });
          }}
        />
      </div>
    );
  }

  return (
    <form
      className={styles.group}
      aria-label={person === null ? copy.form.addTitle : copy.form.changeTitle(person.email)}
      onSubmit={(event) => {
        event.preventDefault();
        if (person === null && alreadyListed(book.people, draft.email)) {
          setStep({ step: "failed", failure: { code: "already_listed", fields: [] } });
          return;
        }
        setStep({
          step: "checking",
          sent: { email: draft.email.trim(), active: draft.active, grants: [...draft.grants] },
        });
      }}
    >
      <p className={styles.ruleTitle}>{person === null ? copy.form.addTitle : copy.form.changeTitle(person.email)}</p>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="staff-email">
            {copy.form.email}
          </label>
          <input
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
          <p className={styles.hint}>{copy.form.emailHint}</p>
        </div>
      </div>
      <label className={`${styles.fieldRow} ${styles.once ?? ""}`}>
        <input
          className={styles.box}
          type="checkbox"
          checked={draft.active}
          onChange={(event) => {
            edit({ active: event.target.checked });
          }}
        />
        {copy.form.letIn}
      </label>
      <fieldset className={styles.choices}>
        <legend className={styles.fieldLabel}>{copy.form.access}</legend>
        <ul className={staffStyles.grants}>
          {draft.grants.map((grant, index) => (
            <GrantRow
              key={index}
              index={index}
              grant={grant}
              book={book}
              onChange={(changed) => {
                editGrant(index, changed);
              }}
              onRemove={() => {
                edit({ grants: draft.grants.filter((_, at) => at !== index) });
              }}
            />
          ))}
        </ul>
      </fieldset>
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
      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          size="small"
          className={styles.save}
          disabled={draft.email.trim() === ""}
        >
          {copy.form.review}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} onClick={onCancel}>
          {copy.form.cancel}
        </Button>
      </div>
      {step.step === "failed" && (
        <p className={styles.error} role="alert">
          {refusalOf(copy.errors, step.failure)}
        </p>
      )}
    </form>
  );
}
