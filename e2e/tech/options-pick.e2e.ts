// A consultation's pick on Options, kept on the phone as it is made (docs/decisions/0247-the-steps-left.md): it stays
// through leaving the step and a reload, a pick the card no longer offers is never sent, and a refused close opens on
// the close with the pick it sent.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { queuedOnPhone } from "./on-phone.ts";
import { startedThrough, stepAction, writesTo } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const { steps, options } = techCopy;

const natural = (page: Page) => page.getByRole("button", { name: /^Mane Man Natural/ });

async function atTheOutcome(page: Page) {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  startedThrough(fake, "before_photos", "checklist", "consumables", "profile");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await expect(page.getByRole("heading", { level: 1, name: options.title })).toBeVisible();
  return fake;
}

test("a pick stays through leaving the step and a reload", async ({ page }) => {
  await atTheOutcome(page);
  await natural(page).click();
  await expect(natural(page)).toHaveAttribute("aria-pressed", "true");

  await page.goto(`/jobs/${JOB_ID}`);
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await expect(natural(page)).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(natural(page)).toHaveAttribute("aria-pressed", "true");

  // A second tap undoes it, and the phone lets it go.
  await natural(page).click();
  await expect(natural(page)).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(natural(page)).toHaveAttribute("aria-pressed", "false");
});

test("a pick of a product the card no longer offers is never sent", async ({ page }) => {
  const fake = await atTheOutcome(page);
  await page.evaluate(async (jobId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });
    await new Promise<void>((resolve, reject) => {
      const write = db.transaction("device", "readwrite");
      write.objectStore("device").put({ key: "options_draft", job_id: jobId, picked: "retired_tier" });
      write.oncomplete = () => {
        resolve();
      };
      write.onerror = () => {
        reject(new Error("not written"));
      };
    });
  }, JOB_ID);
  await page.reload();

  await stepAction(page).click();
  await page.getByRole("button", { name: steps.outcome.done, exact: true }).click();
  await page.getByRole("button", { name: steps.outcome.yes }).click();
  await stepAction(page).click();
  await expect.poll(() => writesTo(fake, "outcome").at(-1)?.body).toEqual({ outcome: "done", going_ahead: true });
});

test("a refused close opens on the close, with the pick it sent", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  startedThrough(fake, "before_photos", "checklist", "consumables", "profile");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await queuedOnPhone(page, [
    {
      id: "01000000-0000-7000-8000-00000000000d",
      kind: "outcome",
      route: "outcome",
      body: { outcome: "done", going_ahead: true, product: "natural" },
      refused: { note: "invalid_request", fields: ["product"] },
    },
  ]);

  await page.goto("/waiting");
  await page.getByRole("button", { name: techCopy.queue.correct }).click();

  await expect(page.getByRole("heading", { level: 1, name: steps.titles.outcome })).toBeVisible();
  await page.getByRole("button", { name: steps.outcome.yes }).click();
  await expect(page.getByText(steps.outcome.picked("Mane Man Natural"))).toBeVisible();
  // Back is Options, with the pick it sent.
  await page.getByRole("button", { name: steps.back }).click();
  await expect(natural(page)).toHaveAttribute("aria-pressed", "true");
});
