// A member of staff's grants, as the Staff page says them and as its boxes hold them.

import type { StaffGrant, StaffPerson } from "../api.ts";
import { settings } from "../content.ts";

const copy = settings.staff;

export type Department = StaffGrant["department"];
type Level = StaffGrant["level"];

export const DEPARTMENTS: readonly Department[] = ["operations", "customer_care", "finance", "growth", "admin"];
export const LEVELS: readonly Level[] = ["view", "act", "manage"];

/** A box's value as the department or level it names; a value the box never offers keeps what was there. */
export const departmentOf = (value: string, was: Department): Department =>
  DEPARTMENTS.find((department) => department === value) ?? was;
export const levelOf = (value: string, was: Level): Level => LEVELS.find((level) => level === value) ?? was;

type Where = Pick<StaffGrant, "geography" | "place">;

function placeWords(where: Where): string {
  if (where.geography === "national" || where.place === null) return copy.national;
  return where.geography === "zone" ? copy.zone(where.place) : where.place;
}

/** "Finance · Act · Delhi", "Operations · View · NCR zone". */
export function grantWords(grant: StaffGrant): string {
  return copy.grant(copy.departments[grant.department], copy.levels[grant.level], placeWords(grant));
}

/** The place box's value: "national", "zone:NCR" or "city:Delhi". */
export function whereValue(where: Where): string {
  return where.place === null ? where.geography : `${where.geography}:${where.place}`;
}

export function whereOf(value: string): Where {
  const [geography = "", ...name] = value.split(":");
  const place = name.join(":");
  if (geography === "zone" || geography === "city") return { geography, place };
  return { geography: "national", place: null };
}

/**
 * Whether an e-mail typed to add a person names someone already listed. Saving it would replace their grants whole,
 * so the form sends them to Change instead.
 */
export function alreadyListed(people: readonly StaffPerson[], typed: string): boolean {
  const email = typed.trim().toLowerCase();
  return people.some((each) => each.email === email);
}

export const sameGrant = (one: StaffGrant, other: StaffGrant): boolean =>
  one.department === other.department &&
  one.level === other.level &&
  one.geography === other.geography &&
  one.place === other.place;
