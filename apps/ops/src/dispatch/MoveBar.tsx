// The bar above the board while a job is in hand: what is moving and how much of a day it takes, and the keyboard's way
// to a destination, a list of the windows it would land in on the rows on screen, nearest first (ADR 0120).

import { Field, Select } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { shortDate } from "@maneman/web-kit/dates";
import { useState, type Ref } from "react";
import type { BoardRow, BookingWindow } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import type { InHand } from "./Grid.tsx";
import { nameOf, type Target, windowWord } from "./job.ts";

/** "a first fit, 2 slots": the job's kind and the slots it takes. */
function sizeOf(inHand: InHand): string {
  const { job } = inHand;
  const type = job.kind === "block" ? job.block.type : job.job.type;
  const slots = job.kind === "block" ? job.block.slots : job.job.slots;
  const name = type === null ? dispatch.unnamed : dispatch.typeNames[type].toLowerCase();
  return dispatch.landing.size(name, slots);
}

interface Destination {
  readonly key: string;
  readonly target: Target;
  readonly label: string;
  readonly km: number | null;
}

/** The nearest first; a day with no distance after every one with, in the board's order. */
const nearestFirst = (a: Destination, b: Destination) => (a.km ?? Infinity) - (b.km ?? Infinity);

/** Every window the job would land in, on the rows shown, the nearest technician's day first. */
function destinationsOf(inHand: InHand, rows: readonly BoardRow[], dates: readonly string[]): Destination[] {
  return rows
    .flatMap((technician) =>
      dates.flatMap((date) => {
        const km = inHand.kmAt(technician.technician_id, date);
        return (inHand.windowsAt(technician.technician_id, date) ?? []).map((window: BookingWindow) => ({
          key: `${technician.technician_id}/${date}/${window}`,
          target: { technician, date, window },
          label: dispatch.landing.listOption(technician.name, shortDate(date), windowWord(window), km),
          km,
        }));
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
          <Field label={copy.list} className={styles.field}>
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
