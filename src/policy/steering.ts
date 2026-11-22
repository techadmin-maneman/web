// The starts a client is offered (docs/decisions/0293-steering-booking-times.md): of those some technician can take,
// a start that would add more driving to its best technician's day than the day's least-driving start does, by more
// than ops allow, is not shown, unless it is the day's last; of those shown, the few that cost least are marked
// Recommended. Ops see every start. Ops set both figures in Settings.

export const STEERING_KEYS = ["recommended", "drive_cap"] as const;
export type Steering = Readonly<Record<(typeof STEERING_KEYS)[number], number>>;

/** Three starts a day marked Recommended; a start adding over half an hour more driving than the day's best not shown. */
export const STEERING: Steering = { recommended: 3, drive_cap: 30 };

/** A start as booking offers it: its time, "HH:MM", and who can take it, best first. */
interface Offered {
  readonly time: string;
  readonly takers: readonly { readonly addedDrive: number; readonly cost: number; readonly homeKnown: boolean }[];
}

/**
 * The driving a start adds to its best technician's day; null where their home is not set, whose driving nobody can
 * tell, which neither sets the day's best nor is left out against it.
 */
const driveOf = (start: Offered): number | null =>
  start.takers[0]?.homeKnown === false ? null : (start.takers[0]?.addedDrive ?? 0);

/** Whether a start's best technician's home is known: those first, as booking weighs who takes a start. */
const known = (start: Offered): number => Number(start.takers[0]?.homeKnown !== false);

/**
 * A day's starts as a client is offered them, in their order: those whose best technician the start would drive more
 * than `drive_cap` minutes beyond the day's least-driving start left out, but never the day's last; each shown start
 * marked `recommended` where it is one of the `recommended` that cost least, whoever's home is known first, then the
 * earlier where they cost the same. A quiet day, every start of which drives alike, keeps them all.
 */
export function steer<Start extends Offered>(
  starts: readonly Start[],
  steering: Steering,
): (Start & { readonly recommended: boolean })[] {
  const last = starts.reduce<string | null>(
    (latest, start) => (latest === null || start.time > latest ? start.time : latest),
    null,
  );
  const drives = starts.flatMap((start) => driveOf(start) ?? []);
  const least = drives.length === 0 ? 0 : Math.min(...drives);
  const shown = starts.filter((start) => {
    const drive = driveOf(start);
    return start.time === last || drive === null || drive - least <= steering.drive_cap;
  });
  const cheapest = new Set(
    [...shown]
      .sort(
        (a, b) =>
          known(b) - known(a) || (a.takers[0]?.cost ?? 0) - (b.takers[0]?.cost ?? 0) || a.time.localeCompare(b.time),
      )
      .slice(0, steering.recommended)
      .map((start) => start.time),
  );
  return shown.map((start) => ({ ...start, recommended: cheapest.has(start.time) }));
}
