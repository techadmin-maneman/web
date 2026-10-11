// A day on the road (OPS-03): each technician's visits in order, the drive between each two, whether it fits the gap
// the board left, and the picture of it. The jobs are the board's own (dispatchBoard), so the map never shows a visit
// the board doesn't. A visit is where its client's address is pinned; one without a pin has no drive to or from it.

import type { BookingWindow } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { sha256Hex } from "../../lib/hash.ts";
import { MINUTES_PER_UNIT } from "../../policy/visit-length.ts";
import type { Alert } from "../../providers/alerts.ts";
import type { MapRoute, Point, RouteResult, RoutesProvider } from "../../providers/routes/index.ts";
import { MOST_STOPS } from "../../providers/routes/google.ts";
import type { PlacesReached } from "../../policy/access.ts";
import { withinCeiling } from "../platform/ceilings.ts";
import type { CountedAt } from "../sign-in/rate-limit.ts";
import { dispatchBoard } from "./dispatch-board.ts";

/** A colour each, in board order, so the list and the map agree on whose day is whose. */
const COLOURS = ["1f6feb", "cf222e", "1a7f37", "9a6700", "8250df", "bc4c00", "0e7490", "be185d"] as const;

/** How long a drive Google answered is kept: the road between two pins changes rarely, and each answer costs a call. */
const KEPT_SECONDS = 24 * 60 * 60;

interface DayStop {
  readonly appointment_id: string;
  readonly starts_at: string;
  /** When the visit's time on the board ends: its slots, as the board places them. */
  readonly ends_at: string;
  readonly window: BookingWindow;
  readonly type: VisitType | null;
  readonly sector: string | null;
  readonly client: string | null;
  readonly located: boolean;
}

interface DayLeg {
  readonly from: string;
  readonly to: string;
  readonly minutes: number;
  readonly km: number;
  /** From the end of one visit's time to the start of the next's. */
  readonly gap_minutes: number;
  readonly fits: boolean;
}

interface TechnicianDay {
  readonly technician_id: string;
  readonly name: string;
  readonly initials: string;
  readonly colour: string;
  readonly stops: DayStop[];
  readonly legs: DayLeg[];
}

/** shown: every drive between two pinned visits is in legs. off: no routes provider. unavailable: Google failed or the day's ceiling is spent. */
type DriveTimes = "shown" | "off" | "unavailable";

interface DayRoute {
  readonly date: string;
  readonly city: string | null;
  readonly drive_times: DriveTimes;
  readonly technicians: TechnicianDay[];
}

interface DayRouteDeps {
  readonly routes: RoutesProvider | null;
  readonly alert: Alert;
}

interface Located extends DayStop {
  readonly point: Point | null;
}

const minutesOf = (seconds: number) => Math.round(seconds / 60);
const kmOf = (meters: number) => Math.round(meters / 100) / 10;

/** Each visit's pin, from its client's current address; a visit not listed has none. */
export async function pinsOf(db: D1Database, appointmentIds: readonly string[]): Promise<Map<string, Point>> {
  if (appointmentIds.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT a.id, d.lat, d.lng FROM appointments a
       JOIN addresses d ON d.person_id = a.person_id AND d.replaced_at IS NULL
       WHERE a.id IN (SELECT value FROM json_each(?1)) AND d.lat IS NOT NULL AND d.lng IS NOT NULL`,
    )
    .bind(JSON.stringify(appointmentIds))
    .all<{ id: string; lat: number; lng: number }>();
  return new Map(results.map((row) => [row.id, { lat: row.lat, lng: row.lng }]));
}

/** The stops in a row with a pin each: a drive runs only between two visits next to each other on the day. */
function runsOf(stops: readonly Located[]): Located[][] {
  const runs: Located[][] = [[]];
  for (const stop of stops) {
    if (stop.point === null) runs.push([]);
    else runs[runs.length - 1]?.push(stop);
  }
  return runs.filter((run) => run.length > 1).map((run) => run.slice(0, MOST_STOPS));
}

/** Google's drive through these pins, kept a day; a miss counts against the day's ceiling. */
async function driveThrough(
  db: D1Database,
  deps: DayRouteDeps & { routes: RoutesProvider },
  { points, at }: { points: readonly Point[]; at: CountedAt },
): Promise<RouteResult> {
  const key = new Request(`https://routes.cache.maneman.in/${await sha256Hex(JSON.stringify(points))}`);
  const kept = await caches.default.match(key).catch(() => undefined);
  if (kept !== undefined) return kept.json<RouteResult>();
  if (!(await withinCeiling(db, deps.alert, "route", at))) return { ok: false, detail: "the day's ceiling is spent" };
  const answer = await deps.routes.route(points);
  if (answer.ok) {
    const keeping = new Response(JSON.stringify(answer), {
      headers: { "Cache-Control": `max-age=${String(KEPT_SECONDS)}` },
    });
    await caches.default.put(key, keeping).catch(() => undefined);
  }
  return answer;
}

function legOf(from: Located, to: Located, leg: { seconds: number; meters: number }): DayLeg {
  const gap = Math.round((Date.parse(to.starts_at) - Date.parse(from.ends_at)) / 60_000);
  const minutes = minutesOf(leg.seconds);
  return {
    from: from.appointment_id,
    to: to.appointment_id,
    minutes,
    km: kmOf(leg.meters),
    gap_minutes: gap,
    fits: minutes <= gap,
  };
}

type BoardRow = Awaited<ReturnType<typeof dispatchBoard>>["technicians"][number];
type BoardBlock = BoardRow["days"][number]["blocks"][number];

function stopOf(block: BoardBlock, point: Point | null): Located {
  const ends = Date.parse(block.starts_at) + block.slots * 2 * MINUTES_PER_UNIT * 60_000;
  return {
    appointment_id: block.appointment_id,
    starts_at: block.starts_at,
    ends_at: new Date(ends).toISOString(),
    window: block.window,
    type: block.type,
    sector: block.sector,
    client: block.client,
    located: point !== null,
    point,
  };
}

interface Driven {
  readonly legs: DayLeg[];
  /** The road Google drew, where the day is one run of pinned visits. */
  readonly polyline: string | null;
  readonly failed: boolean;
}

/** The drives of one technician's day, run by run. */
async function drivesOf(
  db: D1Database,
  deps: DayRouteDeps & { routes: RoutesProvider },
  { stops, at }: { stops: readonly Located[]; at: CountedAt },
): Promise<Driven> {
  const legs: DayLeg[] = [];
  const polylines: (string | null)[] = [];
  let failed = false;
  for (const run of runsOf(stops)) {
    const points = run.flatMap((stop) => (stop.point === null ? [] : [stop.point]));
    const answer = await driveThrough(db, deps, { points, at });
    if (!answer.ok) {
      failed = true;
      continue;
    }
    answer.legs.forEach((leg, step) => {
      const from = run[step];
      const to = run[step + 1];
      if (from !== undefined && to !== undefined) legs.push(legOf(from, to, leg));
    });
    polylines.push(answer.polyline);
  }
  return { legs, polyline: polylines.length === 1 ? (polylines[0] ?? null) : null, failed };
}

interface Drawn {
  readonly route: DayRoute;
  /** The map's routes: each technician with a pinned visit, in their colour. */
  readonly maps: MapRoute[];
}

/** The day's routes for the board's city, as the caller may see them. */
export async function dayRoute(
  db: D1Database,
  deps: DayRouteDeps,
  options: { date: string; city: string | null; reach: PlacesReached; at: CountedAt },
): Promise<Drawn> {
  const { date, city, reach, at } = options;
  const board = await dispatchBoard(db, { from: date, city, reach, now: at.now });
  const working = board.technicians
    .map((row) => ({
      row,
      blocks: [...(row.days[0]?.blocks ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    }))
    .filter(({ blocks }) => blocks.length > 0);
  const pins = await pinsOf(
    db,
    working.flatMap(({ blocks }) => blocks.map((block) => block.appointment_id)),
  );

  const { routes } = deps;
  let driveTimes: DriveTimes = routes === null ? "off" : "shown";
  const technicians: TechnicianDay[] = [];
  const maps: MapRoute[] = [];
  for (const [index, { row, blocks }] of working.entries()) {
    const colour = COLOURS[index % COLOURS.length] ?? COLOURS[0];
    const stops = blocks.map((block) => stopOf(block, pins.get(block.appointment_id) ?? null));
    const driven = routes === null ? null : await drivesOf(db, { ...deps, routes }, { stops, at });
    if (driven?.failed === true) driveTimes = "unavailable";
    const pinned = stops.flatMap((stop) => (stop.point === null ? [] : [stop.point]));
    if (pinned.length > 0) maps.push({ colour, stops: pinned, polyline: driven?.polyline ?? null });
    technicians.push({
      technician_id: row.technician_id,
      name: row.name,
      initials: row.initials,
      colour,
      stops: stops.map(({ point: _point, ...stop }) => stop),
      legs: driven?.legs ?? [],
    });
  }
  return { route: { date, city, drive_times: driveTimes, technicians }, maps };
}
