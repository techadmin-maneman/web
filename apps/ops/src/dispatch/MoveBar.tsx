// The bar above the board while a job is in hand: what is moving and how much of a day it takes, and where it can go,
// a list of the technicians' days on screen with room for it, each from its first free start, nearest first (ADR 0120).
// The start itself is chosen in the move's sheet (./MovePicker.tsx).

import { Field, Select } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { useState, type Ref } from "react";
import type { BoardRow, Room } from "../api.ts";
import { dispatch } from "../content.ts";
import shared from "./dispatch.module.css";
import styles from "./move-bar.module.css";
import { minutesOf, nameOf, type Job, type Target } from "./job.ts";

/** A job in hand, and the starts each technician's day would take it at; null while the board is asking. */
export interface InHand {
  readonly job: Job;
  readonly startsAt: (technicianId: string, date: string) => readonly Room["starts"][number][] | null;
  /** As the crow flies, from the job to the technician's nearest other visit that day; null where unknown. */
  readonly kmAt: (technicianId: string, date: string) => number | null;
}

/** "a first fit, 3 h": the job's kind and the time it holds. */
function sizeOf(inHand: InHand): string {
  const { job } = inHand;
  const type = job.kind === "block" ? job.block.type : job.job.type;
  const slots = job.kind === "block" ? job.block.slots : job.job.slots;
  const name = type === null ? dispatch.unnamed : dispatch.typeNames[type].toLowerCase();
  return dispatch.landing.size(name, minutesOf(slots));
}

interface Destination {
  readonly key: string;
  readonly target: Target;
  readonly label: string;
  readonly km: number | null;
}

/** The nearest first; a day with no distance after every one with, in the board's order. */
const nearestFirst = (a: Destination, b: Destination) => (a.km ?? Infinity) - (b.km ?? Infinity);

/** Every technician's day on the rows shown with room for the job, from its first free start, the nearest first. */
function destinationsOf(inHand: InHand, rows: readonly BoardRow[], dates: readonly string[]): Destination[] {
  return rows
    .flatMap((technician) =>
      dates.flatMap((date): Destination[] => {
        const [first] = inHand.startsAt(technician.technician_id, date) ?? [];
        if (first === undefined) return [];
        const km = inHand.kmAt(technician.technician_id, date);
        const from = dispatch.landing.from(indiaClock(first.starts_at));
        return [
          {
            key: `${technician.technician_id}/${date}`,
            target: { technician, date, window: first.window },
            label: dispatch.landing.listOption(technician.name, shortDate(date), from, km),
            km,
          },
        ];
      }),
    )
    .sort(nearestFirst);
}

interface Props {
  readonly inHand: InHand;
  /** Whether the board has answered where the job fits. */
  readonly checking: boolean;
  readonly rows: readonly BoardRow[];
  readonly dates: readonly string[];
  readonly onLand: (to: Target) => void;
  readonly onStop: () => void;
}

export function MoveBar({ inHand, checking, rows, dates, onLand, onStop, ref }: Props & { ref?: Ref<HTMLDivElement> }) {
  const [chosen, setChosen] = useState("");
  const copy = dispatch.landing;
  const destinations = checking ? [] : destinationsOf(inHand, rows, dates);
  const choice = destinations.find((each) => each.key === chosen);

  return (
    <div className={styles.bar} ref={ref} tabIndex={-1}>
      <p className={styles.barText}>{copy.moving(nameOf(inHand.job), sizeOf(inHand))}</p>
      {checking && <p className={styles.barNote}>{copy.checking}</p>}
      {!checking && destinations.length === 0 && <p className={styles.barNote}>{copy.nowhere}</p>}
      {!checking && destinations.length > 0 && (
        <div className={styles.list}>
          <Field label={copy.list} className={shared.field}>
            {(control) => (
              <Select
                {...control}
                value={chosen}
                onChange={(event) => {
                  setChosen(event.currentTarget.value);
                }}
              >
                <option value="" disabled>
                  {copy.listPrompt}
                </option>
                {destinations.map((each) => (
                  <option key={each.key} value={each.key}>
                    {each.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            variant="outline"
            size="small"
            disabled={choice === undefined}
            onClick={() => {
              if (choice !== undefined) onLand(choice.target);
            }}
          >
            {copy.listGo}
          </Button>
        </div>
      )}
      <Button variant="outline" size="small" onClick={onStop}>
        {copy.stop}
      </Button>
    </div>
  );
}
