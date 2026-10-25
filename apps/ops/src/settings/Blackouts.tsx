// Blackout days: the days no visit is offered (docs/decisions/0088-every-policy-in-the-console.md). The API keeps a row
// a day; the list runs together the days one press added, each run naming who added it. Closing a day moves nothing
// booked on it, so the visits it would strand are counted beneath the boxes as the days are typed, before anything is
// sent, and each run links to the board to move them. A run is reopened from its line, asked once.

import { isBlackoutReason } from "@rules/policy/blackouts.ts";
import { CheckWarning } from "../components/CheckPanel.tsx";
import { Field, DateInput, Select, TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { buttonLook } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { useLoad } from "@maneman/ui/useLoad";
import { addDays, longDate, shortDate } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useEffect, useState } from "react";
import { type Blackout } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { whoWords } from "../lib/who.ts";
import { dispatchPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import form from "../components/forms.module.css";
import { AddForm } from "../components/AddForm.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { settingsApi } from "./settings-api.ts";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { PageActions } from "../components/PageHead.tsx";

const copy = settings.blackouts;

/** Days that follow one another for the same reason, added by the same person at the same moment. */
interface Period {
  readonly from: string;
  readonly to: string;
  /** The one city it is closed in; null for every city. */
  readonly city: string | null;
  readonly reason: string;
  readonly setBy: string | null;
  readonly setAt: string | null;
  readonly booked: number;
}

/** Whether a day carries on a run: the next day, for the same reason, added by the same press. */
const carriesOn = (period: Period, day: Blackout): boolean =>
  addDays(period.to, 1) === day.date &&
  period.city === day.city &&
  period.reason === day.reason &&
  period.setBy === day.set_by &&
  period.setAt === day.set_at;

/** The days, run together where one carries on another. */
function periodsOf(days: readonly Blackout[]): Period[] {
  const periods: Period[] = [];
  for (const day of days) {
    const last = periods.at(-1);
    if (last !== undefined && carriesOn(last, day)) {
      periods[periods.length - 1] = { ...last, to: day.date, booked: last.booked + day.booked };
    } else {
      periods.push({
        from: day.date,
        to: day.date,
        city: day.city,
        reason: day.reason,
        setBy: day.set_by,
        setAt: day.set_at,
        booked: day.booked,
      });
    }
  }
  return periods;
}

const periodWords = (period: { from: string; to: string }) => copy.period(shortDate(period.from), shortDate(period.to));

/** Who added a run of days and when, or that nobody recorded it. */
function setLine(period: Period): string {
  if (period.setBy === null || period.setAt === null) return copy.unrecorded;
  return copy.setBy(whoWords(period.setBy), longDate(period.setAt));
}

/** A city of "" is every city. */
type Draft = { readonly from: string; readonly to: string; readonly city: string; readonly reason: string };

const EMPTY: Draft = { from: "", to: "", city: "", reason: "" };

/** The days a draft or a run names, as the API takes them: no city for every city. */
const periodOf = (period: { from: string; to: string; city: string | null }) => ({
  from: period.from,
  to: period.to,
  ...(period.city === null || period.city === "" ? {} : { city: period.city }),
});

/** The days, the city and the reason, as ops type them. */
function DraftBoxes(props: {
  draft: Draft;
  today: string;
  cities: readonly string[];
  onEdit: (field: keyof Draft, value: string) => void;
}) {
  const { draft, today, cities, onEdit } = props;
  return (
    <div className={form.fields}>
      <Field label={copy.from} className={form.field} box="from">
        {(control) => (
          <DateInput
            {...control}
            width="date"
            min={today}
            value={draft.from}
            onChange={(event) => {
              onEdit("from", event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.to} className={form.field} box="to">
        {(control) => (
          <DateInput
            {...control}
            width="date"
            min={draft.from === "" ? today : draft.from}
            value={draft.to}
            onChange={(event) => {
              onEdit("to", event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.city} className={form.field} box="city">
        {(control) => (
          <Select
            {...control}
            width="date"
            value={draft.city}
            onChange={(event) => {
              onEdit("city", event.target.value);
            }}
          >
            <option value="">{copy.everyCity}</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={copy.reason}
        className={form.field}
        box="reason"
        error={draft.reason.trim() === "" || isBlackoutReason(draft.reason.trim()) ? undefined : copy.errors.reason}
      >
        {(control) => (
          <TextInput
            {...control}
            width="area"
            maxLength={60}
            value={draft.reason}
            onChange={(event) => {
              onEdit("reason", event.target.value);
            }}
          />
        )}
      </Field>
    </div>
  );
}

/** The visits the days would leave booked, counted once both days are typed; null where they could not be. */
function useStranded({ from, to, city }: Draft): number | null {
  const [booked, setBooked] = useState<number | null>(0);
  const named = from !== "" && to !== "" && from <= to;
  useEffect(() => {
    if (!named) return;
    let current = true;
    void settingsApi.blackoutsBooked(periodOf({ from, to, city })).then((answer) => {
      if (current) setBooked(answer.ok ? answer.body.booked : null);
    });
    return () => {
      current = false;
    };
  }, [named, from, to, city]);
  return named ? booked : 0;
}

function CloseDays(props: {
  today: string;
  cities: readonly string[];
  onAdded: (days: readonly Blackout[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const booked = useStranded(draft);
  const edit = (field: keyof Draft, value: string) => {
    setDraft({ ...draft, [field]: value });
  };
  return (
    <AddForm
      title={copy.formTitle}
      words={copy}
      errors={copy.errors}
      boxes={["from", "to", "city", "reason"]}
      send={() => settingsApi.addBlackouts({ ...periodOf(draft), reason: draft.reason.trim() })}
      onAdded={(body) => {
        props.onAdded(body.blackouts);
      }}
      onCancel={props.onCancel}
    >
      <DraftBoxes draft={draft} today={props.today} cities={props.cities} onEdit={edit} />
      {booked !== 0 && <CheckWarning>{booked === null ? copy.uncounted : copy.stranded(booked)}</CheckWarning>}
    </AddForm>
  );
}

interface PeriodRowProps {
  readonly period: Period;
  /** Whether the person's access lets them offer the days again. */
  readonly mayRemove: boolean;
  /** Whether it lets them open the dispatch board, where the visits still booked on the days are moved. */
  readonly mayShow: boolean;
  readonly onRemoved: (days: readonly Blackout[]) => void;
}

function PeriodRow({ period, mayRemove, mayShow, onRemoved }: PeriodRowProps) {
  const words = periodWords(period);
  return (
    <li className={form.rule}>
      <p className={form.period}>
        {words} · {period.city ?? copy.everyCity} · {period.reason}
      </p>
      <p className={form.set}>{setLine(period)}</p>
      {period.booked > 0 && <CheckWarning>{copy.booked(period.booked)}</CheckWarning>}
      {period.booked > 0 && mayShow && (
        <FormActions>
          <OpsLink
            className={buttonLook({ variant: "outline", size: "small", narrow: true })}
            to={dispatchPath({ from: period.from })}
            label={copy.showLabel(words)}
          >
            {copy.show}
          </OpsLink>
        </FormActions>
      )}
      {mayRemove && (
        <DeleteAction
          name={words}
          tone="danger"
          words={copy.reopening}
          send={() => settingsApi.removeBlackouts(periodOf(period))}
          refusal={(code) => errorText(copy.errors, { code })}
          onDeleted={(body) => {
            onRemoved(body.blackouts);
          }}
        />
      )}
    </li>
  );
}

export function Blackouts() {
  const [loaded, retry] = useLoad(settingsApi.blackouts);
  /** The days as the last change left them, so the list follows a change without reading it again. */
  const [changed, setChanged] = useState<readonly Blackout[] | null>(null);
  const access = useAccess();
  const mayAdd = access.mayCall("POST /api/blackouts");
  const mayRemove = access.mayCall("POST /api/blackouts/remove");
  const mayShow = access.mayCall("GET /api/dispatch");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const periods = periodsOf(changed ?? loaded.value.blackouts);

  return (
    <Panel titleId="blackouts" title={copy.title}>
      {mayAdd && (
        <PageActions>
          <DrawerButton primary label={copy.formTitle}>
            {(close) => (
              <CloseDays
                today={loaded.value.today}
                cities={loaded.value.cities}
                onAdded={(next) => {
                  setChanged(next);
                  close();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        </PageActions>
      )}
      {periods.length === 0 ? (
        <Note>{copy.none}</Note>
      ) : (
        <ul className={form.rules}>
          {periods.map((period) => (
            <PeriodRow
              key={`${period.city ?? ""}/${period.from}`}
              period={period}
              mayRemove={mayRemove}
              mayShow={mayShow}
              onRemoved={setChanged}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
