// The day on the road, from today's column of the dispatch board in the header's city: the visits, how each stands,
// and each technician's share, which Dispatch's home and the City head's both count.

import { apiNow } from "@maneman/web-kit/clock";
import { todayInIndia } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import type { Board } from "../api.ts";
import { useCity } from "../lib/city.ts";
import { todayApi } from "./today-api.ts";
import { useRead } from "./reads.ts";

export type Block = Board["technicians"][number]["days"][number]["blocks"][number];

interface Visit {
  readonly block: Block;
  readonly technician: string;
}

export interface Road {
  readonly board: Board;
  readonly date: string;
  readonly visits: readonly Visit[];
}

/** Today's board, in the header's city, once read. */
export function useRoad(): Road | null {
  const { city } = useCity();
  const date = todayInIndia(apiNow());
  const read = useCallback(() => todayApi.board(date, city), [date, city]);
  const board = useRead(read, "GET /api/dispatch");
  if (board === null) return null;
  const visits = board.technicians
    .flatMap((technician) =>
      (technician.days.find((day) => day.date === date)?.blocks ?? []).map((block) => ({
        block,
        technician: technician.name,
      })),
    )
    .sort((one, other) => Date.parse(one.block.starts_at) - Date.parse(other.block.starts_at));
  return { board, date, visits };
}

export const isDone = (block: Block): boolean => block.status === "completed" || block.begun === "closed";

/** Past its start, and nobody there yet. */
export const isLate = (block: Block, now: number): boolean =>
  block.begun === null &&
  (block.status === "scheduled" || block.status === "dispatched") &&
  Date.parse(block.starts_at) < now;

/** Today's unassigned visits, in the tray: no technician yet. */
export const unassignedToday = (road: Road): Board["unassigned"] =>
  road.board.unassigned.filter((job) => job.date === road.date);

/** Whether the technician is away at any time today. */
export const awayToday = (road: Road, technicianId: string): boolean =>
  road.board.leave.some(
    (leave) => leave.technician_id === technicianId && leave.from <= road.date && road.date <= leave.to,
  );
