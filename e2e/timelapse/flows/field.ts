// A day in the field: every active technician's jobs for the day, each worked at its start, on the phone's API in
// the order the server holds it to (src/policy/in-job-steps.ts): arrive, start, the photographs, the profile at a
// consultation, the checklist, what was used, the piece at a fit, the close. The clock runs through the visit, so
// each job takes its length. A wave's chosen job is worked on the technician app's own screens instead (./tech-ui.ts).

import { stepHeaders, techSignIn, type Wire } from "../actors.ts";
import { BASE, catalogue, HAIR_SYSTEMS, PACKAGE } from "./catalog.ts";
import { indiaDateOf, MINUTE } from "../sim.ts";
import { check } from "../steps.ts";
import type { Client, Sim, Technician } from "../world.ts";

export interface Job {
  id: string;
  type: "consultation" | "first_fit" | "service" | "replacement" | null;
  one_visit: boolean;
  starts_at: string;
  status: string;
  minutes: number | null;
  client_name: string | null;
}

interface Kit {
  held: { code: string; units: { code: string }[] }[];
}

/** What each client's profile records at their consultation: one of the four stock codes, or one no code matches. */
export function profileOf(clientIndex: number) {
  const spec =
    clientIndex % 9 === 8
      ? { colour: "4", grey_percent: 30, density_percent: 80 }
      : HAIR_SYSTEMS[clientIndex % HAIR_SYSTEMS.length];
  return { ...BASE, ...(spec ?? HAIR_SYSTEMS[0]) };
}

/** The stock code a profile matches, by the catalogue's order; null for one that matches none. */
export function codeOf(clientIndex: number): string | null {
  if (clientIndex % 9 === 8) return null;
  return catalogue.hairSystems[clientIndex % HAIR_SYSTEMS.length] ?? null;
}

/** Whether the consultation goes ahead to a fit: most do, every fourth does not. */
const goesAhead = (clientIndex: number) => clientIndex % 4 !== 3;

export async function jobsToday(technician: Technician, date: string): Promise<Job[]> {
  if (technician.wire === undefined) return [];
  let answer = await technician.wire.call<{ jobs: Job[] }>("GET", `/api/tech/jobs?date=${date}`);
  if (answer.status === 401 && (await techSignIn(technician.wire, technician.mobile, technician.deviceId))) {
    technician.signIns = (technician.signIns ?? 1) + 1;
    answer = await technician.wire.call<{ jobs: Job[] }>("GET", `/api/tech/jobs?date=${date}`);
  }
  if (answer.status !== 200) return [];
  return answer.body.jobs.filter((job) => ["scheduled", "dispatched", "in_progress"].includes(job.status));
}

/** Every technician's jobs today, each worked at its start, earliest first. */
/**
 * Every technician's jobs today, each worked at its start, earliest first. `onScreen` works the day's first service
 * visit on the technician app's screens instead of the wire, and `offline` has that phone lose its signal mid-job.
 */
export async function fieldDay(
  sim: Sim,
  wave: string,
  options: {
    onScreen?: (technician: Technician, job: Job, offline: boolean) => Promise<boolean>;
    offline?: boolean;
  } = {},
): Promise<void> {
  const date = indiaDateOf(sim.clock.now);
  const all: { technician: Technician; job: Job }[] = [];
  for (const technician of sim.world.technicians.filter((each) => each.active)) {
    for (const job of await jobsToday(technician, date)) all.push({ technician, job });
  }
  all.sort((one, two) => Date.parse(one.job.starts_at) - Date.parse(two.job.starts_at));
  let shown = options.onScreen === undefined;
  for (const [index, { technician, job }] of all.entries()) {
    const start = Date.parse(job.starts_at);
    if (start > sim.clock.now) await sim.clock.advanceTo(start);
    const next = all[index + 1];
    closeBy = next === undefined ? Number.POSITIVE_INFINITY : Date.parse(next.job.starts_at) - MINUTE;
    if (!shown && job.type === "service" && options.onScreen !== undefined) {
      shown = true;
      const done = await options.onScreen(technician, job, options.offline === true);
      const client = sim.world.clients.find((each) => each.name === job.client_name);
      if (done) {
        note(sim, job, client, "done", technician);
        continue;
      }
    }
    await workOnWire(sim, wave, technician, job);
  }
}

/** The latest the clock may move to for a job's close: just before the day's next job starts. */
let closeBy = Number.POSITIVE_INFINITY;

/** Moves the clock to the job's close, unless that is past the next job's start or already behind. */
async function closeAt(sim: Sim, at: number): Promise<void> {
  const target = Math.min(at, closeBy);
  if (target > sim.clock.now) await sim.clock.advanceTo(target);
}

export async function workOnWire(sim: Sim, wave: string, technician: Technician, job: Job): Promise<void> {
  const wire = technician.wire;
  if (wire === undefined) return;
  const clientIndex = sim.world.clients.findIndex((each) => each.name === job.client_name);
  const client = sim.world.clients[clientIndex];
  await sim.steps.run(
    {
      wave,
      workflow: `Field job: ${job.type ?? "visit"}`,
      app: "tech",
      screen: `/jobs/${job.id}`,
      action: `${technician.name} works ${job.client_name ?? "a client"}'s ${job.type ?? "visit"}`,
      mode: "api",
    },
    async () => {
      const type = job.type ?? "service";
      const headers = () => stepHeaders(job.starts_at);
      const post = (path: string, body?: unknown) =>
        wire.must("POST", `/api/tech/jobs/${job.id}/${path}`, body, headers());
      const checkin = await wire.must<{ passed: boolean }>(
        "POST",
        `/api/tech/jobs/${job.id}/checkin`,
        { lat: 28.4598, lng: 77.0268, accuracy_m: 12 },
        headers(),
      );
      check(checkin.passed, "the check-in did not pass the geofence");
      await post("start");
      for (const step of type === "first_fit" || type === "replacement" || job.one_visit ? FIT_STEPS : STEPS_OF[type]) {
        if (step === "photos-before" || step === "photos-after") {
          await post("photos", { phase: step === "photos-before" ? "before" : "after", unavailable: true });
        } else if (step === "profile") {
          await post("profile", {
            fit: {
              norwood_stage: "IV",
              ...profileOf(clientIndex),
              product: PACKAGE,
              head_circumference_cm: 57,
              front_to_nape_cm: 34,
              ear_to_ear_cm: 30,
              temple_to_temple_cm: 28,
              wave: "straight",
              hairline: "natural",
              attachment: "tape",
            },
            history: null,
            based_on: null,
          });
        } else if (step === "checklist") {
          await post("checklist", { done: checklistCodes.get(type) ?? [] });
        } else if (step === "consumables") {
          await post("consumables", {
            items:
              type === "consultation" ? [] : catalogue.consumables.map(({ code, use }) => ({ code, quantity: use })),
          });
        } else if (step === "piece") {
          const piece = await pieceFor(wire, codeOf(clientIndex));
          if (piece === null) {
            await post("outcome", { outcome: "partial", reason: "no_piece", cannot_fit: true });
            note(sim, job, client, "partial", technician);
            return;
          }
          await post(
            "piece",
            type === "replacement" && client?.piece !== undefined
              ? { piece_code: piece, old_piece: { piece_code: client.piece } }
              : { piece_code: piece },
          );
          if (client !== undefined) client.piece = piece;
        } else {
          // The close: the clock moves on through the visit first, so the job takes its length.
          await closeAt(sim, Date.parse(job.starts_at) + Math.max(20, (job.minutes ?? 60) - 10) * MINUTE);
          await post(
            "outcome",
            type === "consultation" ? { outcome: "done", going_ahead: goesAhead(clientIndex) } : { outcome: "done" },
          );
          note(sim, job, client, "done", technician);
          if (client !== undefined && type === "consultation") client.goingAhead = goesAhead(clientIndex);
          if (client !== undefined && (type === "first_fit" || job.one_visit)) {
            client.fitted = true;
            client.fittedOn = sim.clock.day;
          }
        }
      }
    },
  );
}

const STEPS_OF: Readonly<Record<"consultation" | "service", readonly string[]>> = {
  consultation: ["photos-before", "checklist", "consumables", "profile", "outcome"],
  service: ["photos-before", "checklist", "consumables", "photos-after", "outcome"],
};
const FIT_STEPS = ["photos-before", "piece", "checklist", "consumables", "photos-after", "outcome"] as const;

/** Each kind of visit's checklist codes, as Settings · Job sheet holds them, read once. */
export const checklistCodes = new Map<string, string[]>();

export async function readChecklists(ops: Wire): Promise<void> {
  const sheet = await ops.must<{ checklists: { visit_type: string; items: { code: string }[] }[] }>(
    "GET",
    "/api/job-sheet",
  );
  for (const list of sheet.checklists)
    checklistCodes.set(
      list.visit_type,
      list.items.map((item) => item.code),
    );
}

/** A labelled piece of the stock code in the technician's kit; null where there is none or no code matches. */
async function pieceFor(wire: Wire, code: string | null): Promise<string | null> {
  if (code === null) return null;
  const kit = await wire.must<Kit>("GET", "/api/tech/kit");
  return kit.held.find((each) => each.code === code)?.units[0]?.code ?? null;
}

export function note(
  sim: Sim,
  job: Job,
  client: Client | undefined,
  status: "done" | "partial" | "no_show",
  technician?: Technician,
): void {
  const visit = sim.world.visits.get(job.id);
  if (visit !== undefined) {
    visit.status = status;
    visit.technician = technician?.id;
    visit.closedOnDay = sim.clock.day;
  } else if (job.type !== null) {
    sim.world.visits.set(job.id, {
      id: job.id,
      type: job.type,
      client: client?.name ?? "?",
      startsAt: job.starts_at,
      price: 0,
      bookedOnDay: sim.clock.day,
      status,
      technician: technician?.id,
      closedOnDay: sim.clock.day,
    });
  }
  if (client !== undefined) {
    client.lastVisitDay = sim.clock.day;
    if (!client.visits.includes(job.id)) client.visits.push(job.id);
  }
}
