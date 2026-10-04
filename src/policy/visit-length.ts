// How long a visit takes, and how much of a technician's day it holds: the owner's ruling of 27 September 2026, in
// the owner's words as docs/archive/owner-answers-2026-09-27.md records it ("Services, as the console will hold them"). Each
// service carries its own length (the services table, docs/decisions/0085-services-ops-can-edit.md). A visit is
// booked for that long, and the day, counted in half-slots (docs/decisions/0035-window-slot-map.md), keeps the
// half-slots that length needs. src/domain/scheduling.ts places a visit by them, for booking and dispatch alike.

import { UNITS_PER_DAY } from "../config/scheduling.ts";

export const RULES = [
  "each service carries its own length, starting from its kind's (consultation 60 minutes, service 90, replacement 135, first fit 180), and the scheduler reserves that length.",
] as const;

/**
 * The work a half-slot is counted as. The design's blocks are 45 minutes a half-slot: a service visit's 90 minutes is
 * one slot, a replacement's 135 a slot and a half, a first fit's 180 two (VISIT_BLOCKS, src/config/scheduling.ts).
 */
export const MINUTES_PER_UNIT = 45;

/** A visit holds a whole slot however short it is: a technician holds one live job per window. */
const LEAST_UNITS = 2;

/** The half-slots a visit of this length holds: max(2, ceil(minutes / 45)). */
export function unitsFor(minutes: number): number {
  return Math.max(LEAST_UNITS, Math.ceil(minutes / MINUTES_PER_UNIT));
}

/**
 * How long a service may be, in minutes. Half an hour at least; at most what the day's half-slots hold, since a
 * visit longer than the day has nowhere to start, and could never be booked.
 */
export const SERVICE_MINUTES = { min: 30, max: UNITS_PER_DAY * MINUTES_PER_UNIT } as const;

/** Whether a service may be this long: whole minutes, inside SERVICE_MINUTES. */
export const isServiceLength = (minutes: number): boolean =>
  Number.isInteger(minutes) && minutes >= SERVICE_MINUTES.min && minutes <= SERVICE_MINUTES.max;

/**
 * How long a visit already booked takes, as the day keeps it and a move carries it: the longer of its service's
 * length and its booked window, where it has one. So a length ops shorten later leaves no room for a clash, and a
 * visit whose service is unknown keeps its kind's length.
 */
export const bookedLength = (serviceMinutes: number, windowMinutes: number | null): number =>
  Math.max(serviceMinutes, windowMinutes ?? 0);
