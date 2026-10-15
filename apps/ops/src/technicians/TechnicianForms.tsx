// Adding a technician, changing their details, and switching them off or back on (src/routes/ops/technicians.ts).
// Switching off asks first, since it signs them out at once and hands their visits still to come back to the dispatch
// board.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { Button } from "@maneman/ui/Button";
import { Drawer } from "@maneman/ui/Drawer";
import { Checkbox, Field, Select, TextInput } from "@maneman/ui/Field";
import { mobileDigits } from "@maneman/web-kit/mobile";
import { useState } from "react";
import { type ReturnedVisit, type TechnicianChange, type TechnicianSummary } from "../api.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { technicians } from "../content.ts";
import { GIVING_NO_CITY, useAccess } from "../lib/access.ts";
import { phoneWords } from "../lib/phone.ts";
import styles from "./technicians.module.css";
import { Refusal } from "../components/Refusal.tsx";
import { techniciansApi } from "./technicians-api.ts";
import { SwitchOff, SwitchOn } from "./TechnicianSwitch.tsx";
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

function Fields({
  typed,
  cities,
  onType,
  focusFirst,
}: {
  typed: Typed;
  cities: readonly string[];
  onType: (typed: Typed) => void;
  focusFirst: boolean;
}) {
  const copy = technicians.fields;
  const mayGiveNone = useAccess().reaches(GIVING_NO_CITY);
  return (
    <>
      <Field label={copy.name} className={styles.formField}>
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
      <Field label={copy.mobile} className={styles.formField}>
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
      <Field label={copy.zone} className={styles.formField}>
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
      <Field label={copy.city} className={styles.formField}>
        {(control) => (
          <Select
            {...control}
            className={styles.select}
            value={typed.city}
            onChange={(event) => {
              onType({ ...typed, city: event.target.value });
            }}
          >
            {mayGiveNone && <option value="">{copy.noCity}</option>}
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Checkbox
        className={styles.check}
        label={copy.fitsTrained}
        checked={typed.fitsTrained}
        onChange={(event) => {
          onType({ ...typed, fitsTrained: event.target.checked });
        }}
      />
    </>
  );
}

/** A new technician, in a panel over the roster. Their number signs in to the technician app once they are added. */
export function AddTechnician({
  cities,
  onAdded,
  onClose,
}: {
  cities: readonly string[];
  onAdded: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const copy = technicians.add;
  // Staff kept to their cities give them one of theirs; national staff may leave them with none.
  const firstCity = useAccess().reaches(GIVING_NO_CITY) ? "" : (cities[0] ?? "");
  const [typed, setTyped] = useState<Typed>({ name: "", mobile: "", zone: "", city: firstCity, fitsTrained: false });
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
      });
      if (!answer.ok) {
        setFailed(refusal(answer.code));
        return;
      }
      await onAdded(name);
    });

  return (
    <Drawer
      titleId="add-title"
      title={copy.title}
      canClose={!sending}
      onDismiss={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Fields typed={typed} cities={cities} onType={setTyped} focusFirst={false} />
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.save} type="submit" disabled={sending}>
          {sending ? copy.saving : copy.save}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={sending} onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
      {failed !== null && <Refusal className={styles.error} said={failed} />}
    </Drawer>
  );
}

const typedOf = (technician: TechnicianSummary): Typed => ({
  name: technician.name,
  mobile: technician.mobile === null ? "" : phoneWords(technician.mobile),
  zone: technician.zone ?? "",
  city: technician.city ?? "",
  fitsTrained: technician.fits_trained,
});

/** What ops changed, field by field: a field left as it was is not sent. */
function changeOf(technician: TechnicianSummary, typed: Typed): TechnicianChange | "unreadable_mobile" {
  const mobile = mobileDigits(typed.mobile);
  if (mobile === null) return "unreadable_mobile";
  const change: {
    name?: string;
    mobile?: string;
    zone?: string | null;
    city?: string | null;
    fits_trained?: boolean;
  } = {};
  const name = typed.name.trim();
  if (name !== technician.name) change.name = name;
  if (technician.mobile === null || mobile !== mobileDigits(technician.mobile)) change.mobile = mobile;
  const zone = zoneOf(typed.zone);
  if (zone !== technician.zone) change.zone = zone;
  const city = cityOf(typed.city);
  if (city !== technician.city) change.city = city;
  if (typed.fitsTrained !== technician.fits_trained) change.fits_trained = typed.fitsTrained;
  return change;
}

function ChangeForm({
  technician,
  cities,
  onSaved,
  onCancel,
}: {
  technician: TechnicianSummary;
  cities: readonly string[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const copy = technicians.details;
  const [typed, setTyped] = useState<Typed>(() => typedOf(technician));
  const [sending, once] = useOneAtATime();
  const [failed, setFailed] = useState<string | null>(null);

  const send = () =>
    once(async () => {
      const change = changeOf(technician, typed);
      if (change === "unreadable_mobile") {
        setFailed(technicians.errors.unreadable_mobile);
        return;
      }
      if (Object.keys(change).length === 0) {
        onCancel();
        return;
      }
      setFailed(null);
      const answer = await techniciansApi.changeTechnician(technician.id, change);
      if (!answer.ok) {
        setFailed(refusal(answer.code));
        return;
      }
      await onSaved();
    });

  return (
    <form
      className={styles.leaveForm}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Fields typed={typed} cities={cities} onType={setTyped} focusFirst />
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.save} type="submit" disabled={sending}>
          {sending ? copy.saving : copy.save}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
      {failed !== null && <Refusal className={styles.error} said={failed} />}
    </form>
  );
}

/** The number they sign in with, their zone, their city and whether they fit; a gap where none is recorded. */
function Facts({ technician }: { technician: TechnicianSummary }) {
  const copy = technicians.details;
  return (
    <DescriptionList
      items={[
        {
          term: copy.mobile,
          details: technician.mobile === null ? technicians.unknown : phoneWords(technician.mobile),
        },
        { term: copy.zone, details: technician.zone ?? technicians.unknown },
        { term: copy.city, details: technician.city ?? technicians.noCity },
        { term: copy.fitting, details: technician.fits_trained ? copy.trained : copy.notTrained },
      ]}
    />
  );
}

/**
 * Their details, with the ways to change them, in a drawer, and to switch them off or back on where they are ours to
 * change. Each change reads the roster again, because the dispatch board and the sign-in read the same rows.
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
  const [changing, setChanging] = useState(false);
  const access = useAccess();
  const mayChange = access.mayCall("PATCH /api/technicians/{id}");
  const maySwitchOff = active && access.mayCall("POST /api/technicians/{id}/deactivate");
  const maySwitchOn = !active && access.mayCall("POST /api/technicians/{id}/reactivate");
  const mayDelete = access.mayCall("POST /api/technicians/{id}/delete");
  const stopChanging = () => {
    setChanging(false);
  };

  return (
    <section aria-label={copy.title}>
      {!active && <p className={styles.offNote}>{technicians.switchOn.note}</p>}
      <Facts technician={technician} />
      <div className={styles.recordActions}>
        {mayChange && (
          <div className={styles.actions}>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              aria-label={copy.changeLabel(technician.name)}
              onClick={() => {
                setChanging(true);
              }}
            >
              {copy.change}
            </Button>
          </div>
        )}
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
      {changing && (
        <FormDrawer title={technician.name} onClose={stopChanging}>
          <ChangeForm
            technician={technician}
            cities={cities}
            onSaved={async () => {
              await onChange();
              stopChanging();
            }}
            onCancel={stopChanging}
          />
        </FormDrawer>
      )}
    </section>
  );
}
