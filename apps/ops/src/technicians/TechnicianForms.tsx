// Adding a technician, their details changed where they read (docs/decisions/0212-editing-in-place.md), and switching
// them off or back on (src/routes/ops/technicians.ts).
// Switching off asks first, since it signs them out at once and hands their visits still to come back to the dispatch
// board.

import { SubmitButton } from "@maneman/ui/SubmitButton";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { CancelButton } from "@maneman/ui/CancelButton";
import { Drawer } from "@maneman/ui/Drawer";
import { Checkbox, Field, Select, TextInput } from "@maneman/ui/Field";
import { mobileDigits } from "@maneman/web-kit/mobile";
import { useState, type ReactNode } from "react";
import { type ReturnedVisit, type TechnicianChange, type TechnicianSummary } from "../api.ts";
import { DeleteAction } from "@maneman/ui/DeleteAction";
import { ChoiceRow, TextRow } from "@maneman/ui/RecordRows";
import { technicians, CLOSE } from "../content.ts";
import { GIVING_NO_CITY, useAccess } from "../lib/access.ts";
import { phoneWords } from "../lib/phone.ts";
import styles from "./technicians.module.css";
import form from "@maneman/ui/forms.module.css";
import { Refusal } from "@maneman/ui/Refusal";
import { techniciansApi } from "./technicians-api.ts";
import { technicianPayApi } from "../technician-pay/index.ts";
import { SwitchOff, SwitchOn } from "./TechnicianSwitch.tsx";
import { PayGradeField, PayGradeRow } from "./PayGrade.tsx";
import { StartedField, StartedRow } from "./Started.tsx";
import { TrainingField, TrainingRow } from "./Training.tsx";
import { refusal } from "./refusal.ts";

/** The fields as typed and chosen; a city of "" is none. */
interface Typed {
  readonly name: string;
  readonly mobile: string;
  readonly zone: string;
  readonly city: string;
  readonly fitsTrained: boolean;
}

const zoneOf = (typed: string): string | null => (typed.trim() === "" ? null : typed.trim());
const cityOf = (chosen: string): string | null => (chosen === "" ? null : chosen);

/** The technician's city, one of ours, or none for one who may give none. */
function CityField(props: { city: string; cities: readonly string[]; onCity: (city: string) => void }) {
  const copy = technicians.fields;
  const mayGiveNone = useAccess().reaches(GIVING_NO_CITY);
  return (
    <Field label={copy.city}>
      {(control) => (
        <Select
          {...control}
          className={styles.select}
          value={props.city}
          onChange={(event) => {
            props.onCity(event.target.value);
          }}
        >
          {mayGiveNone && <option value="">{copy.noCity}</option>}
          {props.cities.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function Fields({
  typed,
  cities,
  onType,
  focusFirst,
  more,
}: {
  typed: Typed;
  cities: readonly string[];
  onType: (typed: Typed) => void;
  focusFirst: boolean;
  /** Fields of the form's own, on the same grid before the fitting tick. */
  more?: ReactNode;
}) {
  const copy = technicians.fields;
  return (
    <div className={form.fields}>
      <Field label={copy.name}>
        {(control) => (
          <TextInput
            {...control}
            type="text"
            required
            maxLength={80}
            autoComplete="off"
            // A form opened where its button stood takes the keyboard; the add panel takes it itself.
            autoFocus={focusFirst}
            value={typed.name}
            onChange={(event) => {
              onType({ ...typed, name: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={copy.mobile}>
        {(control) => (
          <TextInput
            {...control}
            type="tel"
            required
            autoComplete="off"
            value={typed.mobile}
            onChange={(event) => {
              onType({ ...typed, mobile: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={copy.zone}>
        {(control) => (
          <TextInput
            {...control}
            type="text"
            maxLength={60}
            autoComplete="off"
            value={typed.zone}
            onChange={(event) => {
              onType({ ...typed, zone: event.target.value });
            }}
          />
        )}
      </Field>
      <CityField
        city={typed.city}
        cities={cities}
        onCity={(city) => {
          onType({ ...typed, city });
        }}
      />
      {more}
      <Checkbox
        className={styles.check}
        label={copy.fitsTrained}
        checked={typed.fitsTrained}
        onChange={(event) => {
          onType({ ...typed, fitsTrained: event.target.checked });
        }}
      />
    </div>
  );
}

/** A new technician, in a panel over the roster. Their number signs in to the technician app once they are added. */
export function AddTechnician({
  cities,
  onAdded,
  onClose,
}: {
  cities: readonly string[];
  /** Added, and whether a grade chosen with them was saved; none chosen is saved. */
  onAdded: (name: string, graded: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const copy = technicians.add;
  // Staff kept to their cities give them one of theirs; national staff may leave them with none.
  const firstCity = useAccess().reaches(GIVING_NO_CITY) ? "" : (cities[0] ?? "");
  const [typed, setTyped] = useState<Typed>({ name: "", mobile: "", zone: "", city: firstCity, fitsTrained: false });
  const [trainingEndDate, setTrainingEndsOn] = useState("");
  const [startDate, setStartDate] = useState("");
  const [grade, setGrade] = useState("");
  const [sending, once] = useOneAtATime();
  const [failed, setFailed] = useState<string | null>(null);

  const send = () =>
    once(async () => {
      const mobile = mobileDigits(typed.mobile);
      if (mobile === null) {
        setFailed(technicians.errors.unreadable_mobile);
        return;
      }
      setFailed(null);
      const name = typed.name.trim();
      const answer = await techniciansApi.addTechnician({
        name,
        mobile,
        zone: zoneOf(typed.zone),
        city: cityOf(typed.city),
        fits_trained: typed.fitsTrained,
        ...(trainingEndDate === "" ? {} : { training_end_date: trainingEndDate }),
        ...(startDate === "" ? {} : { start_date: startDate }),
      });
      if (!answer.ok) {
        setFailed(refusal(answer.code));
        return;
      }
      const graded = grade === "" || (await technicianPayApi.setPayGradeOf(answer.body.id, grade)).ok;
      await onAdded(name, graded);
    });

  return (
    <Drawer
      titleId="add-title"
      title={copy.title}
      close={!sending ? CLOSE : null}
      onDismiss={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Fields
        typed={typed}
        cities={cities}
        onType={setTyped}
        focusFirst={false}
        more={
          <>
            <StartedField value={startDate} onChange={setStartDate} />
            <TrainingField value={trainingEndDate} onChange={setTrainingEndsOn} />
            <PayGradeField value={grade} onChange={setGrade} />
          </>
        }
      />
      <div className={styles.actions}>
        <SubmitButton className={styles.save} disabled={sending}>
          {sending ? copy.saving : copy.save}
        </SubmitButton>
        <CancelButton disabled={sending} onClick={onClose} />
      </div>
      {failed !== null && <Refusal className={styles.error} said={failed} />}
    </Drawer>
  );
}

/** Their details, each changed where it reads: a change is sent alone, and the roster read again. */
function DetailRows({
  technician,
  cities,
  onChange,
}: {
  technician: TechnicianSummary;
  cities: readonly string[];
  onChange: () => Promise<void>;
}) {
  const copy = technicians.details;
  const fields = technicians.fields;
  const access = useAccess();
  const mayChange = access.mayCall("PATCH /api/technicians/{id}");
  const mayGiveNone = access.reaches(GIVING_NO_CITY);
  const save = async (change: TechnicianChange): Promise<string | null> => {
    const answer = await techniciansApi.changeTechnician(technician.id, change);
    if (!answer.ok) return refusal(answer.code);
    await onChange();
    return null;
  };
  const cityChoices: (readonly [string, string])[] = [
    ...(mayGiveNone || technician.city === null ? [["", fields.noCity] as const] : []),
    ...cities.map((city) => [city, city] as const),
  ];
  return (
    <div className={styles.rows}>
      <TextRow
        label={fields.name}
        value={technician.name}
        maxLength={80}
        mayChange={mayChange}
        save={(name) => save({ name: name.trim() })}
      />
      <TextRow
        label={copy.mobile}
        type="tel"
        value={technician.mobile === null ? "" : phoneWords(technician.mobile)}
        shown={technician.mobile === null ? technicians.unknown : phoneWords(technician.mobile)}
        maxLength={20}
        mayChange={mayChange}
        save={(typed) => {
          const mobile = mobileDigits(typed);
          return mobile === null ? Promise.resolve(technicians.errors.unreadable_mobile) : save({ mobile });
        }}
      />
      <TextRow
        label={copy.zone}
        value={technician.zone ?? ""}
        shown={technician.zone ?? copy.notSet}
        maxLength={60}
        mayChange={mayChange}
        save={(zone) => save({ zone: zoneOf(zone) })}
      />
      <ChoiceRow
        label={copy.city}
        value={technician.city ?? ""}
        choices={cityChoices}
        mayChange={mayChange}
        save={(city) => save({ city: cityOf(city) })}
      />
      <ChoiceRow
        label={copy.fitting}
        value={technician.fits_trained ? "trained" : "not_trained"}
        choices={[
          ["trained", copy.trained],
          ["not_trained", copy.notTrained],
        ]}
        mayChange={mayChange}
        save={(fitting) => save({ fits_trained: fitting === "trained" })}
      />
      <StartedRow
        startDate={technician.start_date}
        mayChange={mayChange}
        save={(started) => save({ start_date: started })}
      />
      <TrainingRow
        endsOn={technician.training_end_date}
        mayChange={mayChange}
        save={(endsOn) => save({ training_end_date: endsOn })}
      />
      <PayGradeRow technicianId={technician.id} />
    </div>
  );
}

/**
 * Their details, each changed where it reads, and the ways to switch them off or back on, or delete one added by
 * mistake, where they are ours to change. Each change reads the roster again, because the dispatch board and the
 * sign-in read the same rows.
 */
export function Details({
  technician,
  cities,
  active,
  onChange,
  onSwitchedOff,
  onSwitchedOn,
  onDeleted,
}: {
  technician: TechnicianSummary;
  cities: readonly string[];
  active: boolean;
  onChange: () => Promise<void>;
  onSwitchedOff: (visits: readonly ReturnedVisit[]) => Promise<void>;
  onSwitchedOn: () => Promise<void>;
  onDeleted: () => void;
}) {
  const copy = technicians.details;
  const access = useAccess();
  const maySwitchOff = active && access.mayCall("POST /api/technicians/{id}/deactivate");
  const maySwitchOn = !active && access.mayCall("POST /api/technicians/{id}/reactivate");
  const mayDelete = access.mayCall("POST /api/technicians/{id}/delete");

  return (
    <Panel titleId="technician-details" title={copy.title}>
      {!active && <Note>{technicians.switchOn.note}</Note>}
      <DetailRows technician={technician} cities={cities} onChange={onChange} />
      <div className={styles.recordActions}>
        {maySwitchOff && <SwitchOff technician={technician} onSwitchedOff={onSwitchedOff} />}
        {maySwitchOn && <SwitchOn technician={technician} onSwitchedOn={onSwitchedOn} />}
        {mayDelete && (
          <DeleteAction
            name={technician.name}
            send={() => techniciansApi.deleteTechnician(technician.id)}
            refusal={(code) => (code === "in_use" ? technicians.inUse : refusal(code))}
            onDeleted={onDeleted}
          />
        )}
      </div>
    </Panel>
  );
}
