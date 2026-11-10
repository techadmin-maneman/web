// A client's hair profile (docs/decisions/0106-a-clients-hair-profile.md): the fit spec a piece is made to, and the
// history of what they have tried.
//
// The technician records it at a consultation and at a consultation and fit in one visit, ops correct it in the
// console, and every change is a new version (src/domain/clients/hair-profiles.ts). The history is recorded with the fit
// spec, on no consent of its own: it is what the client has told us.
//
// The lists below are codes; their words are each app's. There is no CHECK on them in the database, so a new code
// needs no migration.

import type { VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";

export const NORWOOD_STAGES = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;
export type NorwoodStage = (typeof NORWOOD_STAGES)[number];

/** The suppliers' colour codes, "#1B" written without its "#". */
export const COLOURS = ["1", "1B", "2", "3", "4", "5", "6", "7", "8"] as const;
export type Colour = (typeof COLOURS)[number];

/** In per cent, as suppliers order it. */
export const DENSITIES = [80, 100, 120, 140] as const;
export type Density = (typeof DENSITIES)[number];

export const WAVES = ["straight", "slight_wave", "wavy", "curly"] as const;
export type Wave = (typeof WAVES)[number];

export const HAIRLINES = ["natural", "receded", "straight", "widows_peak"] as const;
export type Hairline = (typeof HAIRLINES)[number];

/** How the piece is held on: tape, glue, or both. */
export const ATTACHMENTS = ["tape", "glue", "both"] as const;
export type Attachment = (typeof ATTACHMENTS)[number];

export const REMEDIES = ["none", "minoxidil", "finasteride", "transplant", "other_systems", "other"] as const;
export type Remedy = (typeof REMEDIES)[number];

/**
 * Each measurement's range in inches, taken to one decimal: the head's as the base's, as suppliers order it
 * (docs/decisions/0240-consultation-rules-and-inches.md). Wide enough for any head or base, and
 * narrow enough that centimetres typed for inches are refused.
 */
export const MEASUREMENTS = {
  head_circumference_in: { min: 15.5, max: 28 },
  front_to_nape_in: { min: 7.5, max: 20 },
  ear_to_ear_in: { min: 7.5, max: 20 },
  temple_to_temple_in: { min: 7.5, max: 20 },
  base_width_in: { min: 2, max: 12 },
  base_length_in: { min: 2, max: 14 },
} as const;
export type Measurement = keyof typeof MEASUREMENTS;

/**
 * The head's measurements in centimetres, as a phone or console of the release before sends and reads them, each
 * with its twin in inches, the range it is checked in. Taken and given for one release, then gone with their columns.
 */
export const CENTIMETRES = {
  head_circumference_cm: "head_circumference_in",
  front_to_nape_cm: "front_to_nape_in",
  ear_to_ear_cm: "ear_to_ear_in",
  temple_to_temple_cm: "temple_to_temple_in",
} as const satisfies Record<string, Measurement>;
export type Centimetre = keyof typeof CENTIMETRES;

const CM_PER_INCH = 2.54;

/** Centimetres in inches, to one decimal. */
export const inchesOf = (cm: number): number => Math.round((cm / CM_PER_INCH) * 10) / 10;

/** Inches in centimetres, to one decimal. */
export const centimetresOf = (inches: number): number => Math.round(inches * CM_PER_INCH * 10) / 10;

export const GREY_PERCENT = { min: 0, max: 100 } as const;

/** "Short free text". */
export const SKIN_AND_ALLERGIES_MAX = 200;

/** The earliest year a transplant is taken to have been done in. */
export const FIRST_TRANSPLANT_YEAR = 1970;

/**
 * The visits the technician records the profile at: a consultation, a consultation and fit in one visit (a declined
 * one is a consultation), and a first fit, where the head is measured again before the piece goes on.
 */
export function takesProfile(type: VisitType, oneVisit: boolean): boolean {
  return oneVisit || type === "consultation" || type === "first_fit";
}

interface History {
  readonly remedies: readonly string[];
  readonly transplant_year: number | null;
  readonly skin_and_allergies: string | null;
}

/**
 * The fields of a history that do not hold together, or none: "none" said alone and each remedy once, and
 * a transplant's year, no later than this one, given only with a transplant.
 */
export function historyProblems(history: History, now: Date): string[] {
  const problems: string[] = [];
  const named = new Set(history.remedies);
  const saysNone = named.has("none") && named.size > 1;
  if (saysNone || named.size !== history.remedies.length) problems.push("remedies");

  const year = history.transplant_year;
  if (year === null) return problems;
  const thisYear = Number(indiaDate(now).slice(0, 4));
  const inRange = year >= FIRST_TRANSPLANT_YEAR && year <= thisYear;
  if (!named.has("transplant") || !inRange) problems.push("transplant_year");
  return problems;
}
