// The technician app against the local mm-api, with nothing faked: the one real-wire run of a field app in CI
// (ADR 0075, as amended). e2e/tech/ proves each screen against a fake held to the contract; this proves the fake and
// the API agree where only the API can say: the sign-in, the step order's 409, the job's start every write carries,
// the photographs' upload links, and a write refused because ops moved the job under the phone.

import type { Page } from "@playwright/test";
import { LOCAL_LOGIN_CODE, PORTS } from "../../scripts/lib/local-stack.ts";
import { addDays, indiaDate } from "../../src/lib/india-time.ts";
import { expect, test } from "../support.ts";
import { AT_THE_DOOR, liveDay } from "./day.ts";

const day = liveDay();
const OPS = `http://ops.localhost:${String(PORTS.ops)}`;

/** Signs in through the app, as a technician does, with the code the local API sends every number. */
async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Mobile number" }).fill(day.mobile);
  await page.getByRole("button", { name: "Send the code" }).click();
  await page.getByRole("textbox", { name: "Code" }).fill(LOCAL_LOGIN_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /jobs? today$/ })).toBeVisible();
}

/** Takes the five photographs of a set, and sends it. */
async function photograph(page: Page): Promise<void> {
  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Done" }).click();
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["camera", "geolocation"]);
  await context.setGeolocation(AT_THE_DOOR);
});

test("signs in, checks in, works a service visit's steps in the API's order and closes it", async ({ page }) => {
  const { id, startsAt } = day.worked;
  await signIn(page);
  await page.goto(`/jobs/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: day.client })).toBeVisible();
  await page.getByRole("button", { name: "I have arrived" }).click();
  await expect(page.getByText("2 · Waiting")).toBeVisible();

  // The order is the API's to keep: an outcome before the job has started is refused, whatever a phone sends.
  const early = await page.evaluate(
    async ({ job, starts }) => {
      const answer = await fetch(`/api/tech/jobs/${job}/outcome`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Event-Id": crypto.randomUUID(),
          "X-Job-Starts-At": starts,
        },
        body: JSON.stringify({ outcome: "done" }),
      });
      return { status: answer.status, body: (await answer.json()) as { error: { code: string } } };
    },
    { job: id, starts: startsAt },
  );
  expect(early.status).toBe(409);
  expect(early.body.error.code).toBe("out_of_order");

  const written: string[] = [];
  page.on("request", (request) => {
    // The steps, not the photographs' upload links, which change nothing on the job.
    const step = request.url().includes(`/api/tech/jobs/${id}/`) && !request.url().endsWith("/upload-url");
    if (request.method() === "POST" && step) {
      written.push(request.headers()["x-job-starts-at"] ?? "none");
    }
  });
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Before photos" })).toBeVisible();
  await photograph(page);

  await expect(page.getByRole("heading", { level: 1, name: "Service checklist" })).toBeVisible();
  for (const item of await page.getByRole("listitem").getByRole("button").all()) await item.click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Consumables used" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "After photos" })).toBeVisible();
  await photograph(page);
  await expect(page.getByRole("heading", { level: 1, name: "Outcome" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const closing = page.waitForResponse((answer) => answer.url().endsWith(`/api/tech/jobs/${id}/outcome`));
  await page.getByRole("button", { name: "Next" }).click();
  expect((await closing).status()).toBe(202);
  await expect(page.getByText(`${day.client} · done`)).toBeVisible();

  // Every write carried the start the phone holds, which is the API's own.
  expect(new Set(written)).toEqual(new Set([startsAt]));

  // Read again from the API: the job is closed.
  await page.goto(`/jobs/${id}`);
  await expect(page.getByText("Closed out · done")).toBeVisible();
});

test("a job ops moved while the phone held it is refused, and the card says it moved", async ({ page, context }) => {
  const { id, startsAt } = day.moved;
  await signIn(page);
  await page.goto(`/jobs/${id}`);
  await expect(page.getByRole("button", { name: "I have arrived" })).toBeVisible();

  // Ops move it to a morning a week out, through the console's own API, while the card stays open on the phone.
  const desk = await context.newPage();
  await desk.goto(OPS);
  const date = addDays(indiaDate(new Date()), 6);
  const move = await desk.evaluate(
    async (body) => {
      const answer = await fetch("/api/dispatch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return answer.status;
    },
    {
      appointment_id: id,
      date,
      window: "morning",
      reason: "client_asked",
      expected_technician_id: day.technicianId,
      expected_starts_at: startsAt,
    },
  );
  expect(move).toBe(200);
  await desk.close();

  // The phone's check-in still carries the start it held, so the API refuses it. The app reads the card again and
  // says where the job went, and the card is the moved one, not yet open to check in at.
  const refused = page.waitForResponse((answer) => answer.url().endsWith(`/api/tech/jobs/${id}/checkin`));
  await page.getByRole("button", { name: "I have arrived" }).click();
  expect((await refused).status()).toBe(409);
  await expect(page.getByRole("alert").filter({ hasText: /Ops moved this job to 9 am on .+\./ })).toBeVisible();
  await expect(page.getByText(/^Opens at /)).toBeVisible();
  await expect(page.getByRole("button", { name: "I have arrived" })).toHaveCount(0);
});
