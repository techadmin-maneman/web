// The starts a client is offered (docs/decisions/0293-steering-booking-times.md): of those some technician can take,
// a start that would add more driving to its technician's day than the day's least-driving start does, by more than
// ops allow, is not shown, unless it is the day's last; of those within it, the few that cost least are marked
// Recommended. Ops see every start. Ops set both figures in Settings.

export const STEERING_KEYS = ["recommended", "drive_cap"] as const;
export type Steering = Readonly<Record<(typeof STEERING_KEYS)[number], number>>;

/** Three starts a day marked Recommended; a start adding over half an hour more driving than the day's best not shown. */
export const STEERING: Steering = { recommended: 3, drive_cap: 30 };

/** A technician who can take a start: the driving it adds, what it costs in all, and whether their home is known. */
interface Taking {
  readonly technician: { readonly id: string };
  readonly addedDrive: number;
  readonly cost: number;
  readonly homeKnown: boolean;
}

/** A start as booking offers it: its time, "HH:MM", and who can take it, best first. */
interface Offered {
  readonly time: string;
  readonly takers: readonly Taking[];
}

/**
 * Who a start is weighed by: who would take it, the best first, but for a client's move its own technician where they
 * can take it, as the hold puts them first (src/domain/booking/hold-slot.ts).
 */
const weigherOf = (start: Offered, keeping: string | null): Taking | undefined =>
  start.takers.find((taker) => taker.technician.id === keeping) ?? start.takers[0];

/**
 * A day's starts as a client is offered them, in their order: those that would drive their technician more than
 * `drive_cap` minutes beyond the day's least-driving start left out, but never the day's last; of those within it, the
 * `recommended` that cost least marked, whoever's home is known first, then the earlier where they cost the same. A
 * start whose technician has no home pin, whose driving nobody can tell, neither sets the day's best nor is left out. A
 * quiet day, every start of which drives alike, keeps them all.
 */
export function steer<Start extends Offered>(
  starts: readonly Start[],
  steering: Steering,
  keeping: string | null = null,
): (Start & { readonly recommended: boolean })[] {
  const drive = (start: Offered): number | null => {
    const weigher = weigherOf(start, keeping);
    return weigher?.homeKnown === false ? null : (weigher?.addedDrive ?? 0);
  };
  const drives = starts.flatMap((start) => drive(start) ?? []);
  const least = drives.length === 0 ? 0 : Math.min(...drives);
  const within = (start: Offered) => {
    const minutes = drive(start);
    return minutes === null || minutes - least <= steering.drive_cap;
  };
  const last = starts.reduce<string | null>(
    (latest, start) => (latest === null || start.time > latest ? start.time : latest),
    null,
  );
  const shown = starts.filter((start) => start.time === last || within(start));
  const known = (start: Offered) => Number(weigherOf(start, keeping)?.homeKnown !== false);
  const cost = (start: Offered) => weigherOf(start, keeping)?.cost ?? 0;
  const cheapest = new Set(
    shown
      .filter(within)
      .sort((a, b) => known(b) - known(a) || cost(a) - cost(b) || a.time.localeCompare(b.time))
      .slice(0, steering.recommended)
      .map((start) => start.time),
  );
  return shown.map((start) => ({ ...start, recommended: cheapest.has(start.time) }));
}
