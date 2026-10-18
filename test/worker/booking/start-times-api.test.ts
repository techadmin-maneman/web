// Booking by start time in the app's API (docs/decisions/0210-booking-by-start-time.md): each day's grid of starts, a
// step apart, open or taken, and a hold of the start the client chose. NOW is Monday 21 September 2026, 12 noon in
// India, so the first bookable day is Tuesday the 22nd. Every name and number here is made up.

import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { IMRAN, SANA, client, technician, visit } from "./client-booking-fixtures.ts";
import { env } from "cloudflare:workers";

interface Start {
  time: string;
  starts_at: string;
  arrives_by: string;
  open: boolean;
}

let app: App;

const startsOn = async (who: { cookie: string }, date: string): Promise<Start[]> => {
  const answer = await request(app, `/api/availability?type=service&from=${date}`, { headers: { Cookie: who.cookie } });
  const body = await answer.json<{ days: { date: string; starts: Start[] }[] }>();
  return body.days.find((day) => day.date === date)?.starts ?? [];
};

const hold = (who: { cookie: string }, body: object) =>
  request(app, "/api/holds", {
    method: "POST",
    headers: { Cookie: who.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  // Who each client's last visit was with, switched off since.
  await technician(SANA, "Sana Mirza", "SM");
  await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANA).run();
});

describe("a day's starts", () => {
  it("run every half hour from 9 to the last a service visit and its wrap-up end by 8, each with its arrival window", async () => {
    const starts = await startsOn(await client(), "2026-09-22");
    expect(starts.map((start) => start.time)).toEqual(
      Array.from({ length: 19 }, (_, index) => {
        const minute = 9 * 60 + index * 30;
        return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      }),
    );
    expect(starts[0]).toMatchObject({
      starts_at: "2026-09-22T03:30:00.000Z",
      arrives_by: "2026-09-22T04:00:00.000Z",
      open: true,
    });
  });

  it("are taken around a visit already booked, its wrap-up and the drive to it", async () => {
    // Imran's service visit from 11 to 12:30 on Tuesday.
    await visit(null, "service", "scheduled", "2026-09-22T05:30:00.000Z", IMRAN);
    const open = (await startsOn(await client(), "2026-09-22"))
      .filter((start) => start.open)
      .map((start) => start.time);
    // Done by 10:40, then ten minutes' drive, before 11; and from 12:50, so 1 pm.
    expect(open.slice(0, 4)).toEqual(["09:00", "13:00", "13:30", "14:00"]);
  });
});

describe("a hold of a start", () => {
  it("holds the start the client chose, in its window, arriving within half an hour", async () => {
    const answer = await hold(await client(), {
      type: "service",
      date: "2026-09-22",
      starts_at: "2026-09-22T06:00:00.000Z",
    });
    expect(answer.status).toBe(201);
    // 11:30 in India, in the morning's window.
    expect(await answer.json()).toMatchObject({
      window: "morning",
      starts_at: "2026-09-22T06:00:00.000Z",
      ends_at: "2026-09-22T07:30:00.000Z",
      arrives_by: "2026-09-22T06:30:00.000Z",
      technician: { name: "Imran Qureshi" },
    });
  });

  it("is refused for a start already taken, and for a window and a start both", async () => {
    const asked = { type: "service", date: "2026-09-22", starts_at: "2026-09-22T06:00:00.000Z" };
    expect((await hold(await client(), asked)).status).toBe(201);
    const taken = await hold(await client(), asked);
    expect(taken.status).toBe(409);
    expect((await taken.json<{ error: { code: string } }>()).error.code).toBe("taken");
    expect((await hold(await client(), { ...asked, window: "morning" })).status).toBe(400);
  });
});
