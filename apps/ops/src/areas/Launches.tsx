// Launches, readiness and pauses under Areas › Served (docs/decisions/0221-launches-scheduled-paused-and-checked.md):
// the launches ops have scheduled, each cancelled once asked; the chosen pincodes scheduled for a later day, with what
// their city still needs; and served ones paused, taking no new clients till a day, or resumed.

import { Badge } from "@maneman/ui/Badge";
import { Button } from "@maneman/ui/Button";
import { DateInput, Field, Fieldset } from "@maneman/ui/Field";
import { Toast } from "@maneman/ui/Toast";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { addDays, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import type { LaunchReadiness, PincodeLaunch } from "../api.ts";
import { areas } from "../content.ts";
import form from "../components/forms.module.css";
import { CheckPanel, CheckWarning } from "../components/CheckPanel.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { useAccess } from "../lib/access.ts";
import shared from "./areas.module.css";
import { areasApi } from "./areas-api.ts";

const copy = areas.launches;

/** Where each check is put right; the map's centres place themselves within the hour. */
const FIX_AT: Readonly<Partial<Record<LaunchReadiness["check"], string>>> = {
  technicians: "/technicians",
  fitters: "/technicians",
  hours: "/technicians",
  homes: "/technicians",
  stockroom: "/stock",
  gst: "/settings/cities",
};

const STATE_TONE = { scheduled: "attention", live: "done", cancelled: "neutral" } as const;

function LaunchRow({ launch, onCancel }: { launch: PincodeLaunch; onCancel: (() => void) | null }) {
  const day = shortDate(launch.go_live_on);
  return (
    <li className={shared.launchItem}>
      <p className={shared.launchLine}>
        <Badge tone={STATE_TONE[launch.state]}>
          {copy.states[launch.state]}
        </Badge>{" "}
        {copy.line(launch.city, day, launch.pincodes.length)}
        {launch.alerted !== null && ` · ${copy.told(launch.alerted)}`}
      </p>
      <p className={shared.note}>{launch.pincodes.map((each) => `${each.pincode} ${each.area}`).join(", ")}</p>
      {launch.held_because !== null && <p className={shared.error}>{copy.held}</p>}
      {onCancel !== null && (
        <Button
          variant="outline"
          size="small"
          narrow
          aria-label={copy.cancelLabel(launch.city, day)}
          onClick={onCancel}
        >
          {copy.cancel}
        </Button>
      )}
    </li>
  );
}

/** Every launch, those scheduled first; one scheduled cancelled once asked. */
export function LaunchList() {
  const [loaded] = useLoad(areasApi.launches);
  const mayCancel = useAccess().mayCall("POST /api/pincode-launches/{id}/cancel");
  const [asking, setAsking] = useState<PincodeLaunch | null>(null);
  const [busy, once] = useOneAtATime();
  const [said, setSaid] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const launches = loaded.state === "loaded" ? loaded.value.launches : [];

  const cancel = (launch: PincodeLaunch) =>
    once(async () => {
      setCode(null);
      const answer = await areasApi.cancelLaunch(launch.id);
      setAsking(null);
      if (answer.ok) setSaid(copy.cancelled);
      else setCode(answer.code);
    });

  return (
    <Fieldset className={form.group} legend={copy.title} legendLook="title">
      {launches.length === 0 && <p className={shared.note}>{copy.none}</p>}
      {asking !== null && (
        <CheckPanel
          question={copy.cancelCheck(asking.city, shortDate(asking.go_live_on))}
          busy={busy}
          onSend={() => void cancel(asking)}
          onBack={() => {
            setAsking(null);
          }}
        />
      )}
      <ul className={shared.launchList}>
        {launches.map((launch) => (
          <LaunchRow
            key={launch.id}
            launch={launch}
            onCancel={
              mayCancel && launch.state === "scheduled"
                ? () => {
                    setAsking(launch);
                  }
                : null
            }
          />
        ))}
      </ul>
      {said !== null && <Toast>{said}</Toast>}
      {code !== null && <Refusal className={shared.error} said={errorText(copy.errors, { code })} />}
    </Fieldset>
  );
}

/** What the city still needs, each line linked to where it is put right. */
function Readiness({ city, pincodes }: { city: string; pincodes: readonly string[] }) {
  const key = pincodes.join(" ");
  const load = useCallback(() => areasApi.readiness(city, key.split(" ")), [city, key]);
  const [loaded] = useLoad(load);
  const words = areas.readiness;
  if (loaded.state !== "loaded") return <p className={shared.note}>{words.loading}</p>;
  return (
    <div className={shared.readiness}>
      <p className={shared.readinessTitle}>{words.title}</p>
      <ul className={shared.checks}>
        {loaded.value.checks.map(({ check, ready, count }) => {
          const fix = FIX_AT[check];
          return (
            <li key={check} className={ready ? shared.ready : shared.missing}>
              {words.checks[check](ready, count)}
              {!ready && fix !== undefined && (
                <>
                  {" · "}
                  <OpsLink to={fix}>{words.fix}</OpsLink>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {loaded.value.checks.some((each) => each.check === "technicians" && !each.ready) && (
        <CheckWarning>{words.blocks}</CheckWarning>
      )}
    </div>
  );
}

/** A day after today, as the date box takes it. */
const tomorrow = () => addDays(todayInIndia(Date.now()), 1);

/** The chosen pincodes, unserved, scheduled for a day after today. */
function ScheduleForm(props: {
  city: string;
  pincodes: readonly string[];
  onDone: (said: string) => void;
  onBack: () => void;
}) {
  const [day, setDay] = useState(tomorrow);
  const [busy, once] = useOneAtATime();
  const [code, setCode] = useState<string | null>(null);
  const schedule = () =>
    once(async () => {
      setCode(null);
      const answer = await areasApi.schedule(props.city, props.pincodes, day);
      if (answer.ok) props.onDone(copy.scheduled(props.pincodes.length, shortDate(day)));
      else setCode(answer.code);
    });
  return (
    <Fieldset className={form.group} legend={copy.scheduleTitle(props.pincodes.length, props.city)} legendLook="title">
      <Readiness city={props.city} pincodes={props.pincodes} />
      <Field label={copy.day} className={shared.field}>
        {(control) => (
          <DateInput
            {...control}
            min={tomorrow()}
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
            }}
          />
        )}
      </Field>
      <FormActions>
        <Button variant="primary" size="small" disabled={busy || day === ""} onClick={() => void schedule()}>
          {busy ? copy.scheduling : copy.schedule}
        </Button>
        <Button variant="outline" size="small" narrow onClick={props.onBack}>
          {copy.back}
        </Button>
      </FormActions>
      {code !== null && <Refusal className={shared.error} said={errorText(copy.errors, { code })} />}
    </Fieldset>
  );
}

/** Served pincodes paused till a day, or resumed. */
function PauseForm(props: {
  pincodes: readonly string[];
  anyPaused: boolean;
  onDone: (until: string | null, said: string) => void;
  onBack: () => void;
}) {
  const words = areas.pause;
  const [day, setDay] = useState(tomorrow);
  const [busy, once] = useOneAtATime();
  const [code, setCode] = useState<string | null>(null);
  const send = (until: string | null) =>
    once(async () => {
      setCode(null);
      const answer = await areasApi.pause(props.pincodes, until);
      if (!answer.ok) {
        setCode(answer.code);
        return;
      }
      const count = props.pincodes.length;
      props.onDone(until, until === null ? words.resumed(count) : words.paused(count, shortDate(until)));
    });
  return (
    <Fieldset className={form.group} legend={words.title(props.pincodes.length)} legendLook="title">
      <Field label={words.until} hint={words.hint} className={shared.field}>
        {(control) => (
          <DateInput
            {...control}
            min={tomorrow()}
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
            }}
          />
        )}
      </Field>
      <FormActions>
        <Button variant="primary" size="small" disabled={busy || day === ""} onClick={() => void send(day)}>
          {busy ? words.pausing : words.pause}
        </Button>
        {props.anyPaused && (
          <Button variant="outline" size="small" narrow disabled={busy} onClick={() => void send(null)}>
            {words.resume}
          </Button>
        )}
        <Button variant="outline" size="small" narrow onClick={props.onBack}>
          {words.back}
        </Button>
      </FormActions>
      {code !== null && <Refusal className={shared.error} said={errorText(words.errors, { code })} />}
    </Fieldset>
  );
}

export type ChosenForm = "schedule" | "pause" | null;

/** The form the chosen bar opened, for the chosen pincodes of one city. */
export function ChosenForms(props: {
  open: ChosenForm;
  city: string;
  chosen: readonly { pincode: string; served: boolean; paused_until: string | null }[];
  onPaused: (pincodes: readonly string[], until: string | null) => void;
  onClose: (said: string | null) => void;
}) {
  const pincodes = props.chosen.map((each) => each.pincode);
  if (props.open === "schedule") {
    return (
      <ScheduleForm
        city={props.city}
        pincodes={pincodes}
        onDone={props.onClose}
        onBack={() => {
          props.onClose(null);
        }}
      />
    );
  }
  if (props.open === "pause") {
    return (
      <PauseForm
        pincodes={pincodes}
        anyPaused={props.chosen.some((each) => each.paused_until !== null)}
        onDone={(until, said) => {
          props.onPaused(pincodes, until);
          props.onClose(said);
        }}
        onBack={() => {
          props.onClose(null);
        }}
      />
    );
  }
  return null;
}
