// The City head's home on Today (ADR 0227), in their city: today's visits and those running late, the money collected
// today and the concerns open; beside Needs you, each technician's day, and who is away. Its sentence is how much of
// the day is booked.

import { apiNow } from "@maneman/web-kit/clock";
import { indiaClock, todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, type ReactNode } from "react";
import type { Tasks } from "../api.ts";
import { clients, dispatch, noShows } from "../content.ts";
import { today as copy } from "../content/today.ts";
import { useHeading } from "../frame/PageHead.tsx";
import { useCity } from "../lib/city.ts";
import { SECTION_NAMES } from "../route.ts";
import { roadFigures } from "./DispatchHome.tsx";
import { countOf } from "./homes.ts";
import { AsideList, HomeLayout, type AsideRow, type Shown } from "./HomeLayout.tsx";
import { useRead } from "./reads.ts";
import { awayToday, useRoad, type Road } from "./road.ts";
import { todayApi } from "./today-api.ts";

/** The money collected today, once read: its figure, and the amount for a sentence. */
export function useCollected(note?: string): { figure: Shown; amount: string | null } {
  const date = todayInIndia(apiNow());
  const read = useCallback(() => todayApi.money(date), [date]);
  const money = useRead(read, "GET /api/payments");
  if (money === null) return { figure: null, amount: null };
  const amount = rupees(money.collected);
  return {
    figure: { label: noShows.money.figures.collected(true), value: amount, note, page: "payments" },
    amount,
  };
}

/** Each technician on today's board: how many visits, the first of them, and whether they are away. */
function technicians(road: Road): AsideRow[] {
  return road.board.technicians.map((technician) => {
    const visits = road.visits.filter((visit) => visit.technician === technician.name);
    const [first] = visits;
    return {
      key: technician.technician_id,
      lead: clients.credits.visits(visits.length),
      title: technician.name,
      ...(first === undefined ? {} : { meta: indiaClock(first.block.starts_at) }),
      ...(awayToday(road, technician.technician_id)
        ? { state: { words: dispatch.board.away, tone: "neutral" as const } }
        : {}),
    };
  });
}

export function CityHome({ board, needs }: { readonly board: Tasks; readonly needs: ReactNode }) {
  const road = useRoad();
  const { city } = useCity();
  const { visits, late } = roadFigures(road);
  const collected = useCollected().figure;
  const booked = road?.board.utilisation.find((day) => day.date === road.date)?.percent;
  useHeading(booked === undefined ? undefined : copy.greeting.city(city, booked));
  const concerns: Shown = {
    label: SECTION_NAMES.grievances,
    value: countOf(board, "grievance"),
    tone: "attention",
    page: "grievances",
  };
  return (
    <HomeLayout
      figures={[visits, late, collected, concerns]}
      needs={needs}
      aside={
        <AsideList
          page="dispatch"
          id="today-technicians"
          title={SECTION_NAMES.technicians}
          rows={road === null ? null : technicians(road)}
          none={dispatch.board.empty}
        />
      }
    />
  );
}
