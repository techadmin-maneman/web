// The board's day on a phone (./DispatchScreen.tsx), where the hours run off its edge: the visits nobody is on, pinned
// on top, then one technician's visits at a time in the order they start, chips to change technician. Each visit opens
// the drawer it opens on a desk.

import { capsLook } from "@maneman/ui/Caps";
import { EmptyState } from "@maneman/ui/EmptyState";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { indiaClock, indiaDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import type { Block, Board, BoardRow } from "../api.ts";
import { dispatch, tasks } from "../content.ts";
import type { Job } from "./job.ts";
import styles from "./phone-day.module.css";

interface Props {
  readonly board: Board;
  readonly rows: readonly BoardRow[];
  readonly date: string;
  readonly now: number;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
}

const kindOf = (type: Block["type"]) => (type === null ? dispatch.unknown : dispatch.typeNames[type]);

/** How a visit stands, where it says more than booked: done, begun, or past its start with nobody there. */
function stateOf(block: Block, now: number): { words: string; tone: "muted" | "warning" } | null {
  if (block.status === "completed" || block.begun === "closed")
    return { words: dispatch.chips.completed, tone: "muted" };
  if (block.begun === "arrived" || block.begun === "started")
    return { words: dispatch.board.begun[block.begun], tone: "muted" };
  const waiting = block.status === "scheduled" || block.status === "dispatched";
  return waiting && Date.parse(block.starts_at) < now ? { words: dispatch.day.late, tone: "warning" } : null;
}

/** One technician's visits that day, in the order they start, each opening its drawer. */
function TechnicianVisits(props: {
  row: BoardRow;
  visits: readonly Block[];
  date: string;
  now: number;
  onOpen: Props["onOpen"];
}) {
  const { row, visits, date, now, onOpen } = props;
  return (
    <section aria-labelledby="phone-visits" className={styles.section}>
      <h2 id="phone-visits" className={capsLook(styles.label)}>
        {dispatch.day.phoneHead(row.name, visits.length)}
      </h2>
      {visits.length === 0 ? (
        <EmptyState look="panel" line={dispatch.routes.none} />
      ) : (
        <ListRows>
          {visits.map((block) => {
            const state = stateOf(block, now);
            return (
              <ListRow
                key={block.appointment_id}
                lead={indiaClock(block.starts_at)}
                title={block.client ?? dispatch.unknown}
                meta={[kindOf(block.type), block.sector].filter((part) => part !== null).join(" · ")}
                end={state?.words}
                endTone={state?.tone}
                rule={state?.tone === "warning" ? "warning" : undefined}
                onClick={() => {
                  onOpen({ kind: "block", block, technician: row, date }, openerOf());
                }}
              />
            );
          })}
        </ListRows>
      )}
    </section>
  );
}

/** Where the keyboard is, which the drawer gives it back to. */
const openerOf = (): HTMLElement =>
  document.activeElement instanceof HTMLElement ? document.activeElement : document.body;

export function PhoneDay({ board, rows, date, now, onOpen }: Props) {
  const blocksOf = (row: BoardRow) =>
    [...(row.days.find((day) => day.date === date)?.blocks ?? [])].sort((one, other) =>
      one.starts_at.localeCompare(other.starts_at),
    );
  const [first] = rows.filter((row) => blocksOf(row).length > 0);
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = rows.find((row) => row.technician_id === chosen) ?? first ?? rows[0];
  const nobody = board.unassigned.filter((job) => (job.date ?? indiaDate(job.starts_at)) === date);
  const visits = shown === undefined ? [] : blocksOf(shown);
  return (
    <div className={styles.day}>
      <div className={styles.chips} role="radiogroup" aria-label={dispatch.views.technician}>
        {rows.map((row) => (
          <ToggleButton
            key={row.technician_id}
            asRadio
            filled
            pressed={row === shown}
            onClick={() => {
              setChosen(row.technician_id);
            }}
          >
            {row.name}
          </ToggleButton>
        ))}
      </div>
      {nobody.length > 0 && (
        <section aria-labelledby="phone-nobody" className={styles.section}>
          <h2 id="phone-nobody" className={capsLook(styles.label)}>
            {tasks.groups.unassigned_visit}
          </h2>
          <ListRows>
            {nobody.map((job) => (
              <ListRow
                key={job.appointment_id}
                lead={indiaClock(job.starts_at)}
                title={job.client ?? dispatch.unknown}
                meta={kindOf(job.type)}
                rule="error"
                onClick={() => {
                  onOpen({ kind: "unassigned", job }, openerOf());
                }}
              />
            ))}
          </ListRows>
        </section>
      )}
      {shown !== undefined && <TechnicianVisits row={shown} visits={visits} date={date} now={now} onOpen={onOpen} />}
    </div>
  );
}
