// Adding a technician, changing his details, and switching him off or back on (src/routes/ops/technicians.ts).
// Switching off asks first, since it signs him out at once and hands his visits still to come back to the dispatch
// board.

import { capsLook } from "@maneman/ui/Caps";
import { Button, buttonLook } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { Field, TextInput } from "@maneman/ui/Field";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { mobileDigits } from "@maneman/web-kit/mobile";
import { useState } from "react";
import { api, type ReturnedVisit, type TechnicianChange, type TechnicianSummary } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { technicians } from "../content.ts";
import { GIVING_NO_CITY, useAccess } from "../lib/access.ts";
import { phoneWords } from "../lib/phone.ts";
import styles from "./technicians.module.css";

const ERRORS: Readonly<Record<string, string | undefined>> = technicians.errors;

/** Why the API refused, in the console's words; nothing changed either way. */
const refusal = (code: string): string => ERRORS[code] ?? technicians.errors.unknown;

/** The fields as typed and chosen; a city of "" is none. */
interface Typed {
  readonly name: string;
  readonly mobile: string;
  readonly zone: string;
  readonly city: string;
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
      <Field label={copy.city} hint={copy.cityHint} className={styles.formField}>
        {(control) => (
          <select
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
          </select>
        )}
      </Field>
    </>
  );
}

/** A new technician, in a panel over the roster. His number signs in to the technician app once he is added. */
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
  // Staff kept to their cities give him one of theirs; national staff may leave him with none.
  const firstCity = useAccess().reaches(GIVING_NO_CITY) ? "" : (cities[0] ?? "");
  const [typed, setTyped] = useState<Typed>({ name: "", mobile: "", zone: "", city: firstCity });
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async () => {
    const mobile = mobileDigits(typed.mobile);
    if (mobile === null) {
      setFailed(technicians.errors.unreadable_mobile);
      return;
    }
    setSending(true);
    setFailed(null);
    const name = typed.name.trim();
    const answer = await api.addTechnician({ name, mobile, zone: zoneOf(typed.zone), city: cityOf(typed.city) });
    if (!answer.ok) {
      setSending(false);
      setFailed(refusal(answer.code));
      return;
    }
    await onAdded(name);
  };

  return (
    <Dialog className={styles.drawer} labelledBy="add-title" canClose={!sending} onDismiss={onClose}>
      <div className={styles.drawerHead}>
        <h2 className={styles.drawerTitle} id="add-title">
          {copy.title}
        </h2>
      </div>
      <form
        className={styles.drawerBody}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p className={styles.warning}>{copy.effect}</p>
        <Fields typed={typed} cities={cities} onType={setTyped} focusFirst={false} />
        <div className={styles.actions}>
          <Button variant="primary" size="small" className={styles.save} type="submit" disabled={sending}>
            {sending ? copy.saving : copy.save}
          </Button>
          <Button variant="outline" size="small" className={styles.quiet} disabled={sending} onClick={onClose}>
            {copy.cancel}
          </Button>
        </div>
        {failed !== null && (
          <p className={styles.error} role="alert">
            {failed}
          </p>
        )}
      </form>
    </Dialog>
  );
}

const typedOf = (technician: TechnicianSummary): Typed => ({
  name: technician.name,
  mobile: technician.mobile === null ? "" : phoneWords(technician.mobile),
  zone: technician.zone ?? "",
  city: technician.city ?? "",
});

/** What ops changed, field by field: a field left as it was is not sent. */
function changeOf(technician: TechnicianSummary, typed: Typed): TechnicianChange | "unreadable_mobile" {
  const mobile = mobileDigits(typed.mobile);
  if (mobile === null) return "unreadable_mobile";
  const change: { name?: string; mobile?: string; zone?: string | null; city?: string | null } = {};
  const name = typed.name.trim();
  if (name !== technician.name) change.name = name;
  if (technician.mobile === null || mobile !== mobileDigits(technician.mobile)) change.mobile = mobile;
  const zone = zoneOf(typed.zone);
  if (zone !== technician.zone) change.zone = zone;
  const city = cityOf(typed.city);
  if (city !== technician.city) change.city = city;
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
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async () => {
    const change = changeOf(technician, typed);
    if (change === "unreadable_mobile") {
      setFailed(technicians.errors.unreadable_mobile);
      return;
    }
    if (Object.keys(change).length === 0) {
      onCancel();
      return;
    }
    setSending(true);
    setFailed(null);
    const answer = await api.changeTechnician(technician.id, change);
    if (!answer.ok) {
      setSending(false);
      setFailed(refusal(answer.code));
      return;
    }
    await onSaved();
  };

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
      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </form>
  );
}

/** The number he signs in with, his zone and his city; a gap where none is recorded. */
function Facts({ technician }: { technician: TechnicianSummary }) {
  const copy = technicians.details;
  return (
    <dl className={styles.facts}>
      <div className={styles.fact}>
        <dt className={styles.label}>{copy.mobile}</dt>
        <dd className={styles.factValue}>
          {technician.mobile === null ? technicians.unknown : phoneWords(technician.mobile)}
        </dd>
      </div>
      <div className={styles.fact}>
        <dt className={styles.label}>{copy.zone}</dt>
        <dd className={styles.factValue}>{technician.zone ?? technicians.unknown}</dd>
      </div>
      <div className={styles.fact}>
        <dt className={styles.label}>{copy.city}</dt>
        <dd className={styles.factValue}>{technician.city ?? technicians.unknown}</dd>
      </div>
    </dl>
  );
}

function SwitchOff({
  technician,
  onSwitchedOff,
}: {
  technician: TechnicianSummary;
  onSwitchedOff: (visits: readonly ReturnedVisit[]) => Promise<void>;
}) {
  const copy = technicians.switchOff;
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setFailed(null);
    const answer = await api.switchOff(technician.id);
    if (!answer.ok) {
      setSending(false);
      setFailed(refusal(answer.code));
      return;
    }
    await onSwitchedOff(answer.body.visits);
  };

  if (!asking) {
    return (
      <div className={styles.actions}>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          aria-label={copy.openLabel(technician.name)}
          onClick={() => {
            setAsking(true);
          }}
        >
          {copy.open}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.asking}>
      <p className={styles.warning}>{copy.warning}</p>
      <div className={styles.actions}>
        <Button variant="danger" size="small" className={styles.revoke} disabled={sending} onClick={() => void send()}>
          {sending ? copy.sending : copy.confirm}
        </Button>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          disabled={sending}
          onClick={() => {
            setAsking(false);
          }}
        >
          {copy.cancel}
        </Button>
      </div>
      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </div>
  );
}

function SwitchOn({ technician, onSwitchedOn }: { technician: TechnicianSummary; onSwitchedOn: () => Promise<void> }) {
  const copy = technicians.switchOn;
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setFailed(null);
    const answer = await api.switchOn(technician.id);
    if (!answer.ok) {
      setSending(false);
      // His own number taken while he was off: the add form's words would read as if ops had typed it.
      setFailed(answer.code === "number_in_use" ? technicians.errors.number_in_use_now : refusal(answer.code));
      return;
    }
    await onSwitchedOn();
  };

  return (
    <>
      <div className={styles.actions}>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          aria-label={copy.openLabel(technician.name)}
          disabled={sending}
          onClick={() => void send()}
        >
          {sending ? copy.sending : copy.open}
        </Button>
      </div>
      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </>
  );
}

/**
 * His details, with the ways to change them and to switch him off or back on where he is ours to change. Each
 * change reads the roster again, because the dispatch board and the sign-in read the same rows.
 */
export function Details({
  technician,
  cities,
  active,
  onChange,
  onSwitchedOff,
  onSwitchedOn,
}: {
  technician: TechnicianSummary;
  cities: readonly string[];
  active: boolean;
  onChange: () => Promise<void>;
  onSwitchedOff: (visits: readonly ReturnedVisit[]) => Promise<void>;
  onSwitchedOn: () => Promise<void>;
}) {
  const copy = technicians.details;
  const [changing, setChanging] = useState(false);
  const access = useAccess();
  const mayChange = access.mayCall("PATCH /api/technicians/{id}");
  const maySwitchOff = active && access.mayCall("POST /api/technicians/{id}/deactivate");
  const maySwitchOn = !active && access.mayCall("POST /api/technicians/{id}/reactivate");
  const stopChanging = () => {
    setChanging(false);
  };

  return (
    <section className={styles.section} aria-labelledby="details-title">
      <h3 className={capsLook(styles.sectionTitle)} id="details-title">
        {copy.title}
      </h3>
      {!active && <p className={styles.offNote}>{technicians.switchOn.note}</p>}
      {changing ? (
        <ChangeForm
          technician={technician}
          cities={cities}
          onSaved={async () => {
            await onChange();
            stopChanging();
          }}
          onCancel={stopChanging}
        />
      ) : (
        <Facts technician={technician} />
      )}
      {!changing && (
        <>
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
        </>
      )}
    </section>
  );
}

/** The visits a technician just switched off no longer holds, with the way to give them to another. */
export function Returned({ visits }: { visits: readonly ReturnedVisit[] }) {
  const copy = technicians.switchOff;
  return (
    <div className={styles.stranded} role="status">
      <p className={styles.strandedTitle}>{copy.returned(visits.length)}</p>
      {visits.length > 0 && (
        <>
          <ul className={styles.leaveList}>
            {visits.map((visit) => (
              <li className={styles.leaveRow} key={visit.appointment_id}>
                {copy.visit(
                  `${shortDate(indiaDate(visit.starts_at))}, ${indiaClock(visit.starts_at)}`,
                  visit.client ?? copy.noClient,
                )}
              </li>
            ))}
          </ul>
          <OpsLink
            className={buttonLook({ variant: "outline", size: "small", className: styles.quiet })}
            to="/dispatch"
          >
            {copy.move}
          </OpsLink>
        </>
      )}
    </div>
  );
}
