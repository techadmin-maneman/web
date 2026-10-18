// Where the job in hand would land in the week on screen (./DispatchScreen.tsx), so the board offers only those
// technicians' days and the starts on each, and the days ops blacked out.

import { useEffect, useReducer, useState } from "react";
import { type Room } from "../api.ts";
import type { InHand } from "./MoveBar.tsx";
import type { Target } from "./job.ts";
import { dispatchApi } from "./dispatch-api.ts";

/** As the server answered; "unknown" if it could not, and nowhere is offered. */
type Rooms =
  | { readonly state: "checking" }
  | { readonly state: "known"; readonly rooms: readonly Room[]; readonly blackouts: readonly string[] }
  | { readonly state: "unknown" };

/**
 * The rooms for the job in hand, asked again for each week the board turns to with the job still in hand, and each
 * time `askAgain` is called, after a refusal say. An answer that comes back once another job is in hand, or another
 * week is on screen, is dropped.
 */
export function useRooms(inHandId: string | null, weekFrom: string | null): [Rooms, askAgain: () => void] {
  const [rooms, setRooms] = useState<Rooms>({ state: "checking" });
  const [asked, askAgain] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (inHandId === null) return undefined;
    setRooms({ state: "checking" });
    if (weekFrom === null) return undefined;
    let current = true;
    void dispatchApi.room(inHandId, weekFrom).then((answer) => {
      if (!current) return;
      setRooms(
        answer.ok
          ? { state: "known", rooms: answer.body.rooms, blackouts: answer.body.blackouts }
          : { state: "unknown" },
      );
    });
    return () => {
      current = false;
    };
  }, [inHandId, weekFrom, asked]);
  return [rooms, askAgain];
}

/** The starts each technician's day offers the job in hand, earliest first, as the server answered; none if it could not. */
export function daysFrom(rooms: Rooms): InHand["startsAt"] {
  if (rooms.state !== "known") return () => null;
  return (technicianId, date) =>
    rooms.rooms.find((room) => room.technician_id === technicianId && room.date === date)?.starts ?? [];
}

/** How near each day's other visits are, as the server answered; null where it could not say. */
export function kmFrom(rooms: Rooms): InHand["kmAt"] {
  if (rooms.state !== "known") return () => null;
  return (technicianId, date) =>
    rooms.rooms.find((room) => room.technician_id === technicianId && room.date === date)?.km ?? null;
}

/** Every start a move to this technician's day can take, earliest first, as the server answered; none where it could not say. */
export function startsFrom(rooms: Rooms, to: Target): readonly string[] {
  if (rooms.state !== "known") return [];
  const room = rooms.rooms.find((each) => each.technician_id === to.technician.technician_id && each.date === to.date);
  return (room?.starts ?? []).map((each) => each.starts_at);
}

export const isBlackout = (rooms: Rooms, date: string): boolean =>
  rooms.state === "known" && rooms.blackouts.includes(date);
