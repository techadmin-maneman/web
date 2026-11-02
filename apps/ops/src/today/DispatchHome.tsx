// Dispatch's home on Today (ADR 0227), in the header's city: today's visits, those with no technician yet, those
// running late, and the places low on stock; beside Needs you, today's visits still to come in the order they start.
// Its sentence is how many visits today still need a technician.

import type { BadgeTone } from "@maneman/ui/Badge";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaClock, minutesBetween } from "@maneman/web-kit/dates";
import type { ReactNode } from "react";
import type { Tasks } from "../api.ts";
import { dispatch, tasks as taskWords } from "../content.ts";
import { today as copy } from "../content/today.ts";
import { useHeading } from "../frame/PageHead.tsx";
import { dispatchPath } from "../route.ts";
import { AsideList, HomeLayout, type AsideRow, type Shown } from "./HomeLayout.tsx";
import { isDone, isLate, unassignedToday, useRoad, type Block, type Road } from "./road.ts";

/** The day's visits, how many have no technician, and how many are running late, the longest late named beneath. */
export function roadFigures(road: Road | null): { visits: Shown; unassigned: Shown; late: Shown } {
  if (road === null) return { visits: null, unassigned: null, late: null };
  const now = apiNow();
  const blocks = road.visits.map((visit) => visit.block);
  const late = road.visits.filter(({ block }) => isLate(block, now));
  const [longest] = late;
  const underWay = blocks.filter((block) => !isDone(block) && block.begun !== null).length;
  return {
    visits: {
      label: copy.tiles.visits,
      value: road.visits.length,
      note: copy.notes.road(blocks.filter(isDone).length, underWay),
      page: "dispatch",
    },
    unassigned: {
      label: copy.tiles.unassigned,
      value: unassignedToday(road).length,
      tone: "attention",
      page: "dispatch",
    },
    late: {
      label: copy.road.late,
      value: late.length,
      tone: "warning",
      note:
        longest === undefined
          ? undefined
          : copy.notes.late(longest.technician, minutesBetween(longest.block.starts_at, new Date(now).toISOString())),
      page: "dispatch",
    },
  };
}

const kindOf = (block: Pick<Block, "type">): string | null =>
  block.type === null ? null : dispatch.typeNames[block.type];

/** A visit's state, where it says more than booked: late, or the technician there. */
function stateOf(block: Block, now: number): { words: string; tone: BadgeTone } | undefined {
  if (isLate(block, now)) return { words: copy.road.late, tone: "warning" };
  if (block.begun === "arrived" || block.begun === "started")
    return { words: dispatch.board.begun[block.begun], tone: "attention" };
  return undefined;
}

/** Today's visits not yet done, and those with no technician, in the order they start. */
function comingUp(road: Road): AsideRow[] {
  const now = apiNow();
  const open = (visit: string) => dispatchPath({ from: road.date, visit });
  const booked = road.visits
    .filter(({ block }) => !isDone(block))
    .map(({ block, technician }) => ({
      starts: block.starts_at,
      row: {
        key: block.appointment_id,
        lead: indiaClock(block.starts_at),
        title: block.person?.name ?? block.client ?? dispatch.unnamed,
        meta: [kindOf(block), technician].filter((part) => part !== null).join(" · "),
        state: stateOf(block, now),
        to: open(block.appointment_id),
      },
    }));
  const unassigned = unassignedToday(road).map((job) => ({
    starts: job.starts_at,
    row: {
      key: job.appointment_id,
      lead: indiaClock(job.starts_at),
      title: job.person?.name ?? job.client ?? dispatch.unnamed,
      meta: kindOf(job) ?? undefined,
      state: { words: taskWords.groups.unassigned_visit, tone: "error" as const },
      to: open(job.appointment_id),
    },
  }));
  return [...booked, ...unassigned]
    .sort((one, other) => Date.parse(one.starts) - Date.parse(other.starts))
    .map(({ row }) => row);
}

export function DispatchHome({ board, needs }: { readonly board: Tasks; readonly needs: ReactNode }) {
  const road = useRoad();
  const { visits, unassigned, late } = roadFigures(road);
  useHeading(road === null ? undefined : copy.greeting.dispatch(unassignedToday(road).length));
  const lowStock: Shown = {
    label: copy.tiles.lowStock,
    value: board.low_stock_places,
    tone: "attention",
    page: "stock",
  };
  return (
    <HomeLayout
      figures={[visits, unassigned, late, lowStock]}
      needs={needs}
      aside={
        <AsideList
          page="dispatch"
          id="today-road"
          title={copy.road.title}
          rows={road === null ? null : comingUp(road)}
          none={dispatch.routes.none}
        />
      }
    />
  );
}
