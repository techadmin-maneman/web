// Where the job in hand would land in the week on screen (./DispatchScreen.tsx), so the board offers only those
// windows, and the days ops blacked out.

import { useEffect, useReducer, useState } from "react";
import { api, type Room } from "../api.ts";
import type { InHand } from "./Grid.tsx";
import { WINDOWS, type Target } from "./job.ts";

/** As the server answered; "unknown" if it could not, and every window is offered. */
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
    void api.room(inHandId, weekFrom).then((answer) => {
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

/** The windows each day offers the job in hand: the server's answer; every window if it could not answer. */
export function windowsFrom(rooms: Rooms): InHand["windowsAt"] {
  if (rooms.state === "checking") return () => null;
  if (rooms.state === "unknown") return () => WINDOWS;
  return (technicianId, date) =>
    rooms.rooms.find((room) => room.technician_id === technicianId && room.date === date)?.windows ?? [];
}

/** The start a move to this target takes, as the server answered; null where it could not say. */
export function landsAtFrom(rooms: Rooms, to: Target): string | null {
  if (rooms.state !== "known") return null;
  const room = rooms.rooms.find((each) => each.technician_id === to.technician.technician_id && each.date === to.date);
  return room?.starts.find((each) => each.window === to.window)?.starts_at ?? null;
}

export const isBlackout = (rooms: Rooms, date: string): boolean =>
  rooms.state === "known" && rooms.blackouts.includes(date);
