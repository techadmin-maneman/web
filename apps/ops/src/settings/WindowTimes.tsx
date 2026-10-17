// Settings › Window times: the day's eight half-slot starts and its end, from which the morning, afternoon and evening
// are read (docs/decisions/0102-window-times.md). A change applies from a day nothing is booked or bookable on, which
// the API names as the earliest, and is kept for good, so the list of changes only grows.

import { DateInput, Field, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { errorText } from "@maneman/web-kit/refusal";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { Panel } from "@maneman/ui/Panel";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate, shortDate } from "@maneman/web-kit/dates";
import { timeRange, UNBROKEN } from "@rules/lib/time-range.ts";
import { windowTimesOf } from "@rules/policy/slot-times.ts";
import { WINDOW_SLOT_MAP } from "@rules/config/scheduling.ts";
import { useState } from "react";
import type { SlotTimes } from "../api.ts";
import { CheckLine } from "../components/CheckPanel.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { whoWords } from "../lib/who.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { SettingForm, sentOf, useSteps } from "./SettingForm.tsx";
import { settingsApi } from "./settings-api.ts";

const copy = settings.windowTimes;
const WINDOWS = ["morning", "afternoon", "evening"] as const;

/** A day's times as they are typed: the eight starts and the end. */
interface Draft {
  readonly from: string;
  readonly starts: readonly string[];
  readonly end: string;
}

const hoursOf = (times: { unitStarts: readonly string[]; dayEnd: string }) => {
  const windows = windowTimesOf(times);
  return (window: (typeof WINDOWS)[number]) => timeRange(windows[window].start, windows[window].end, UNBROKEN);
};

/** A half-slot's box name: the window it belongs to, and which of that window's half-slots it is. */
function startLabel(unit: number): string {
  const window = WINDOWS.find((each) => WINDOW_SLOT_MAP[each].includes(unit)) ?? WINDOWS[0];
  return copy.start(copy.window[window], WINDOW_SLOT_MAP[window].indexOf(unit) + 1);
}

/** The windows in force, each with its hours. */
function InForce({ times }: { times: SlotTimes }) {
  const hours = hoursOf({ unitStarts: times.in_force.unit_starts, dayEnd: times.in_force.day_end });
  const since = times.in_force.applies_from === null ? null : shortDate(times.in_force.applies_from);
  return (
    <>
      <Note>
        {copy.inForce} · {copy.since(since)}
      </Note>
      <ul className={form.rules}>
        {WINDOWS.map((window) => (
          <li key={window} className={form.rule}>{`${copy.window[window]}: ${hours(window)}`}</li>
        ))}
      </ul>
    </>
  );
}

/** The day's eight starts and its end, each a box. */
function TimeBoxes({ draft, onDraft }: { draft: Draft; onDraft: (draft: Draft) => void }) {
  return (
    <div className={form.fields}>
      {draft.starts.map((start, index) => (
        <Field key={index} label={startLabel(index)} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              type="time"
              value={start}
              onChange={(event) => {
                onDraft({
                  ...draft,
                  starts: draft.starts.map((each, at) => (at === index ? event.target.value : each)),
                });
              }}
            />
          )}
        </Field>
      ))}
      <Field label={copy.dayEnd} className={form.field} box="day_end">
        {(control) => (
          <TextInput
            {...control}
            type="time"
            value={draft.end}
            onChange={(event) => {
              onDraft({ ...draft, end: event.target.value });
            }}
          />
        )}
      </Field>
    </div>
  );
}

/** A change of the times, from a day the API allows, checked against the windows it changes. */
function ChangeForm({ times, said, onSet }: { times: SlotTimes; said: string | null; onSet: () => void }) {
  const [draft, setDraft] = useState<Draft>({
    from: times.earliest,
    starts: times.in_force.unit_starts,
    end: times.in_force.day_end,
  });
  const steps = useSteps(
    async () =>
      sentOf(
        await settingsApi.setSlotTimes({
          applies_from: draft.from,
          unit_starts: [...draft.starts],
          day_end: draft.end,
        }),
        () => ({}),
      ),
    onSet,
  );
  const edit = (next: Draft) => {
    setDraft(next);
    steps.edit();
  };
  const was = hoursOf({ unitStarts: times.in_force.unit_starts, dayEnd: times.in_force.day_end });
  const now = hoursOf({ unitStarts: draft.starts, dayEnd: draft.end });
  const ready = draft.from !== "" && draft.starts.every((start) => start !== "") && draft.end !== "";
  return (
    <SettingForm
      title={copy.formTitle}
      steps={steps}
      ready={ready}
      errors={copy.errors}
      onCancel={null}
      said={said}
      boxes={["applies_from", "day_end"]}
      checking={[
        ...WINDOWS.map((window) => copy.change(copy.window[window], was(window), now(window))),
        copy.from(longDate(draft.from)),
      ].map((line) => (
        <CheckLine key={line}>{line}</CheckLine>
      ))}
    >
      <Field
        label={copy.appliesFrom}
        hint={copy.earliest(longDate(times.earliest))}
        className={form.field}
        box="applies_from"
      >
        {(control) => (
          <DateInput
            {...control}
            min={times.earliest}
            value={draft.from}
            onChange={(event) => {
              edit({ ...draft, from: event.target.value });
            }}
          />
        )}
      </Field>
      <TimeBoxes draft={draft} onDraft={edit} />
    </SettingForm>
  );
}

/** Each window's hours as a change sets them. */
function setsOf(change: SlotTimes["changes"][number]): string[] {
  const hours = hoursOf({ unitStarts: change.unit_starts, dayEnd: change.day_end });
  return WINDOWS.map((window) => `${copy.window[window]} ${hours(window)}`);
}

/** The last change, still to come, withdrawn: the API refuses once a visit is booked or held on its day or after. */
function Withdraw({ from, onWithdrawn }: { from: string; onWithdrawn: () => void }) {
  return (
    <DeleteAction
      name={shortDate(from)}
      words={copy.withdrawing}
      send={() => settingsApi.withdrawSlotTimes(from)}
      refusal={(code) => errorText(copy.errors, { code })}
      onDeleted={onWithdrawn}
    />
  );
}

/** Every change set, each from its day, by whom, and what it sets; the last, while still to come, may be withdrawn. */
function Changes({ times, onWithdrawn }: { times: SlotTimes; onWithdrawn: () => void }) {
  const mayWithdraw = useAccess().mayCall("DELETE /api/slot-times/{applies_from}");
  if (times.changes.length === 0) return <Note>{copy.none}</Note>;
  const last = times.changes.at(-1);
  const toCome = last !== undefined && last.applies_from !== times.in_force.applies_from;
  return (
    <ul className={form.rules}>
      {times.changes.map((change) => (
        <li key={`${change.applies_from}-${change.set_at}`} className={form.rule}>
          {copy.setBy(shortDate(change.applies_from), whoWords(change.set_by), longDate(change.set_at))}
          <br />
          {copy.sets(setsOf(change))}
          {mayWithdraw && toCome && change === last && (
            <Withdraw from={change.applies_from} onWithdrawn={onWithdrawn} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function WindowTimes() {
  const access = useAccess();
  const [loaded, retry] = useLoad(settingsApi.slotTimes);
  const [said, setSaid] = useState<string | null>(null);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const times = loaded.value;
  return (
    <Panel titleId="window-times" title={copy.title} padded>
      <InForce times={times} />
      {access.mayCall("POST /api/slot-times") && (
        <ChangeForm
          key={times.earliest}
          times={times}
          said={said}
          onSet={() => {
            setSaid(copy.set);
            retry();
          }}
        />
      )}
      <h3 className={form.ruleTitle}>{copy.history}</h3>
      <Changes
        times={times}
        onWithdrawn={() => {
          setSaid(copy.withdrawn);
          retry();
        }}
      />
    </Panel>
  );
}
