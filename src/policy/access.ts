// Who may do what in the ops console. A member of staff holds grants: a department, at a level, over a place. A place
// is national, a zone of cities, or one city.

export const DEPARTMENTS = ["operations", "customer_care", "finance", "growth", "admin"] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** In rising order: each level can do everything the ones before it can. */
export const LEVELS = ["view", "act", "manage"] as const;
export type Level = (typeof LEVELS)[number];

export const GEOGRAPHIES = ["national", "zone", "city"] as const;

/** Where a grant reaches, or where a record is. */
export type Place =
  | { readonly geography: "national" }
  | { readonly geography: "zone"; readonly name: string }
  | { readonly geography: "city"; readonly name: string };

export const NATIONAL: Place = { geography: "national" };

export interface Grant {
  readonly department: Department;
  readonly level: Level;
  readonly place: Place;
}

/** Each city's zone, by the city's name. A city in no zone is not in the map. */
export type ZoneOfCity = ReadonlyMap<string, string>;

/**
 * Who is calling. A person not on the Staff list is an inactive person with no grants. A service token is let in
 * as every caller was before the list, or not at all.
 */
export type Caller =
  | { readonly kind: "person"; readonly active: boolean; readonly grants: readonly Grant[] }
  | { readonly kind: "service"; readonly allowed: boolean };

/** What one call is judged by: whether the list is enforced, who the caller is to it, and each city's zone. */
export interface CallerAccess {
  readonly enforced: boolean;
  readonly caller: Caller;
  readonly zoneOf: ZoneOfCity;
}

/** A member of staff as the Staff page edits them. */
export interface StaffEntry {
  readonly active: boolean;
  readonly grants: readonly Grant[];
}

export function reaches(level: Level, needed: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(needed);
}

/** Whether `outer` takes in all of `inner`: national takes in everything, a zone itself and its cities, a city itself. */
export function takesIn(outer: Place, inner: Place, zoneOf: ZoneOfCity): boolean {
  if (outer.geography === "national") return true;
  if (inner.geography === "national") return false;
  if (outer.geography === "city") return inner.geography === "city" && inner.name === outer.name;
  if (inner.geography === "zone") return inner.name === outer.name;
  return zoneOf.get(inner.name) === outer.name;
}

/**
 * Whether the caller may work in a department, at a level, over a place. "anywhere" asks only whether they hold the
 * department at that level over some place, for a route that then keeps to the caller's own places.
 */
export function can(
  caller: Caller,
  department: Department,
  level: Level,
  where: Place | "anywhere",
  zoneOf: ZoneOfCity,
): boolean {
  if (caller.kind === "service") return caller.allowed;
  if (!caller.active) return false;
  return caller.grants.some(
    (grant) =>
      grant.department === department &&
      reaches(grant.level, level) &&
      (where === "anywhere" || takesIn(grant.place, where, zoneOf)),
  );
}

/**
 * The places a caller's work in a department reaches: everywhere, or only some cities. A record is in one city, found
 * by src/domain/places.ts; a record whose city cannot be found is reached only everywhere.
 */
export type PlacesReached =
  | { readonly kind: "everywhere" }
  | { readonly kind: "cities"; readonly cities: ReadonlySet<string> };

const EVERYWHERE: PlacesReached = { kind: "everywhere" };
const NOWHERE: PlacesReached = { kind: "cities", cities: new Set() };

function citiesIn(place: Place, zoneOf: ZoneOfCity): string[] {
  if (place.geography === "city") return [place.name];
  if (place.geography === "national") return [];
  return [...zoneOf].filter(([, zone]) => zone === place.name).map(([city]) => city);
}

/**
 * Where a caller may see or do a department's work at a level: everywhere with a national grant, else the cities their
 * city and zone grants name. Everywhere while the Staff list is not enforced, since nothing is narrowed then.
 */
export function placesReached(access: CallerAccess, department: Department, level: Level): PlacesReached {
  const { caller, zoneOf } = access;
  if (!access.enforced || can(caller, department, level, NATIONAL, zoneOf)) return EVERYWHERE;
  if (caller.kind === "service" || !caller.active) return NOWHERE;

  const cities = new Set<string>();
  for (const grant of caller.grants) {
    if (grant.department !== department || !reaches(grant.level, level)) continue;
    for (const city of citiesIn(grant.place, zoneOf)) cities.add(city);
  }
  return { kind: "cities", cities };
}

/** Whether a record in this city is within reach. One with no city is reached only everywhere. */
export function reachesCity(reached: PlacesReached, city: string | null): boolean {
  if (reached.kind === "everywhere") return true;
  return city !== null && reached.cities.has(city);
}

export function samePlace(one: Place, other: Place): boolean {
  if (one.geography === "national" || other.geography === "national") return one.geography === other.geography;
  return one.geography === other.geography && one.name === other.name;
}

const sameGrant = (one: Grant, other: Grant): boolean =>
  one.department === other.department && one.level === other.level && samePlace(one.place, other.place);

/** The grants an edit gives or takes away. */
export function grantsChanged(before: readonly Grant[], after: readonly Grant[]): Grant[] {
  const taken = before.filter((grant) => !after.some((kept) => sameGrant(kept, grant)));
  const given = after.filter((grant) => !before.some((held) => sameGrant(held, grant)));
  return [...taken, ...given];
}

function mayGive(editor: Caller, grant: Grant, zoneOf: ZoneOfCity): boolean {
  return can(editor, "admin", "manage", grant.place, zoneOf);
}

/**
 * Whether an editor may make this change to a member of staff, or add them when `before` is null. They need to be a
 * person with Admin MANAGE over the place of every grant given or taken away. Switching a person on or off reaches all
 * they hold, so it needs Admin MANAGE over every one of their places.
 */
export function mayEdit(editor: Caller, before: StaffEntry | null, after: StaffEntry, zoneOf: ZoneOfCity): boolean {
  if (editor.kind !== "person" || !can(editor, "admin", "manage", "anywhere", zoneOf)) return false;
  const held = before?.grants ?? [];
  const switched = before !== null && before.active !== after.active;
  const touched = switched ? [...held, ...after.grants] : grantsChanged(held, after.grants);
  return touched.every((grant) => mayGive(editor, grant, zoneOf));
}

/** Whether a viewer sees a member of staff: one with a grant in the viewer's places, or with no grant yet. */
export function maySee(viewer: Caller, entry: StaffEntry, zoneOf: ZoneOfCity): boolean {
  if (entry.grants.length === 0) return can(viewer, "admin", "view", "anywhere", zoneOf);
  return entry.grants.some((grant) => can(viewer, "admin", "view", grant.place, zoneOf));
}

/** Admin MANAGE nationally, while active: of whom there must always be one. */
export function isNationalAdmin(entry: StaffEntry): boolean {
  return (
    entry.active &&
    entry.grants.some(
      (grant) => grant.department === "admin" && grant.level === "manage" && grant.place.geography === "national",
    )
  );
}

/**
 * Who may switch enforcement and change the service tokens: a person with Admin MANAGE nationally. Asked even while
 * the list is not enforced, so nobody locks themselves out and no token lets another in.
 */
export function mayRunAccess(caller: Caller): boolean {
  return caller.kind === "person" && isNationalAdmin(caller);
}

/**
 * Whether saving `entry` for `email` would leave nobody with Admin MANAGE nationally, when somebody has it now. A list
 * with no such person yet, as a new environment's, may be built up from nothing.
 */
export function leavesNoNationalAdmin(
  people: readonly (StaffEntry & { readonly email: string })[],
  email: string,
  entry: StaffEntry,
): boolean {
  const others = people.filter((person) => person.email !== email);
  const before = people.some(isNationalAdmin);
  const after = isNationalAdmin(entry) || others.some(isNationalAdmin);
  return before && !after;
}
