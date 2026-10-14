// A technician never takes two of a client's visits in a row
// (docs/decisions/0111-a-technician-never-takes-two-visits-in-a-row.md): whoever comes to a visit is not whoever comes to
// the client's visit just before it or just after it, unless nobody else can take it, so a city with few technicians
// never leaves a client unable to book (ADR 0117). The client's visits are read by
// src/domain/booking/technician-rotation.ts; the windows offered, the hold, ops' booking and the dispatch board's moves
// all ask the rule here.

/** One of a client's visits, done or still to come, or a booking paid for and not yet a visit: its day and who. */
export interface ClientVisit {
  readonly date: string;
  readonly technicianId: string;
}

/** Places a visit is put: a technician on a day. */
interface Place {
  readonly technicianId: string | null;
  readonly date: string;
}

/**
 * The technicians who may not take a visit of the client's on `date`: whoever has their latest visit before that day,
 * their first after it, and any on the day itself.
 */
export function techniciansBarredOn(visits: readonly ClientVisit[], date: string): ReadonlySet<string> {
  const days = visits.map((visit) => visit.date).sort();
  const before = days.filter((day) => day < date).at(-1);
  const after = days.find((day) => day > date);
  const beside = visits.filter((visit) => visit.date === date || visit.date === before || visit.date === after);
  return new Set(beside.map((visit) => visit.technicianId));
}

/**
 * Whether moving a visit from where it is to `to` puts its technician beside another of the client's visits. A move that
 * keeps its technician and day puts nobody there anew.
 */
export function breaksRotation(visits: readonly ClientVisit[], from: Place, to: Place): boolean {
  if (to.technicianId === null || (to.technicianId === from.technicianId && to.date === from.date)) return false;
  return techniciansBarredOn(visits, to.date).has(to.technicianId);
}

/** Of those who could take a visit, the ones the rule lets: none barred, unless every one of them is. */
export function allowedTechnicians<T>(candidates: readonly T[], barred: (candidate: T) => boolean): T[] {
  const others = candidates.filter((candidate) => !barred(candidate));
  return others.length > 0 ? others : [...candidates];
}
