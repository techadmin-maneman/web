// Alerts (docs/prompts/tech-redesign.md, "Alerts"; docs/decisions/0250-guides-and-alerts.md): Today's bell says how
// many are new and opens the inbox, newest first, which reads them; a row opens its job; Send me turns a kind off; Me
// opens Alerts too, and says how many kinds are on.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech, type Fake } from "./fake-tech.ts";
import { JOB_ID, todayInIndia } from "./fixtures.ts";
import { tab } from "./tabs.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const copy = techCopy.alerts;

type Alert = Fake["inbox"]["alerts"][number];

function alertOf(fields: Partial<Alert>): Alert {
  const sent = new Date(Date.now() - 60_000);
  return {
    id: "al-1",
    kind: "time_to_leave",
    read: false,
    sent_at: sent.toISOString(),
    job_id: JOB_ID,
    date: "2026-09-21",
    type: "service",
    sector: "Sector 65",
    client_name: "Rohit M.",
    starts_at: new Date(sent.getTime() + 38 * 60_000).toISOString(),
    was_starts_at: null,
    leave_by: new Date(sent.getTime() + 8 * 60_000).toISOString(),
    drive_minutes: 18,
    finish_by: null,
    jobs: null,
    navigate: null,
    ...fields,
  };
}

const bell = (page: Page) => page.getByRole("link", { name: /^Alerts/ });

test("Today's bell says how many are new, and opens Alerts, which reads them all", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.inbox = {
    ...fake.inbox,
    alerts: [
      alertOf({}),
      alertOf({
        id: "al-2",
        kind: "running_over",
        sent_at: new Date(Date.now() - 120_000).toISOString(),
        finish_by: new Date().toISOString(),
      }),
    ],
  };
  await page.goto("/");
  await expect(bell(page)).toHaveAccessibleName(copy.bell(2));

  await bell(page).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await expect(page.getByRole("link", { name: /Leave in 8 min for Rohit M\./ })).toBeVisible();
  await expect(page.getByText("18 min drive to Sector 65")).toBeVisible();
  await expect.poll(() => fake.writes.some((write) => write.path === "/api/tech/alerts/read")).toBe(true);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(bell(page)).toHaveAccessibleName(copy.bell(0));
});

test("a row opens its job", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.inbox = { ...fake.inbox, alerts: [alertOf({})] };
  await page.goto("/alerts");
  await page.getByRole("link", { name: /Leave in 8 min for Rohit M\./ }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
});

test("says when there are none, and Send me turns a kind off, which Me then counts", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await tab(page, techCopy.tabs.me).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${copy.title}`) })).toContainText(copy.on(4));
  await page.getByRole("link", { name: new RegExp(`^${copy.title}`) }).click();

  await expect(page.getByText(copy.none)).toBeVisible();
  const dayAhead = page.getByRole("switch", { name: copy.kinds.day_ahead.label });
  await expect(dayAhead).toHaveAttribute("aria-checked", "true");
  await dayAhead.click();
  await expect(dayAhead).toHaveAttribute("aria-checked", "false");
  expect(fake.writes.find((write) => write.path === "/api/tech/alerts/settings")?.body).toEqual({ day_ahead: false });
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("link", { name: new RegExp(`^${copy.title}`) })).toContainText(copy.on(3));
});

/** The phone's notifications as a test sets them: the permission, and a push service that takes or refuses. */
/** "held" is a phone that already holds a subscription, made with a key since replaced. */
async function phoneNotifications(
  page: Page,
  permission: "default" | "denied" | "granted",
  service: "takes" | "refuses" | "held",
) {
  await page.addInitScript(
    ([given, answer]) => {
      const state: { permission: string } = { permission: given };
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          get permission() {
            return state.permission;
          },
          requestPermission: () => {
            state.permission = "granted";
            return Promise.resolve("granted");
          },
        },
      });
      const held = {
        endpoint: "https://fcm.googleapis.com/fcm/send/old-key-phone",
        options: { applicationServerKey: new Uint8Array([4, 1, 2, 3]).buffer },
        unsubscribe: () => {
          document.documentElement.dataset.unsubscribed = "yes";
          return Promise.resolve(true);
        },
      };
      const pushManager = {
        getSubscription: () => Promise.resolve(answer === "held" ? held : null),
        subscribe: () =>
          answer === "refuses"
            ? Promise.reject(new Error("the push service refused"))
            : Promise.resolve({ endpoint: "https://fcm.googleapis.com/fcm/send/test-phone" }),
      };
      // The tests block service workers; the app reads the one the phone would have.
      Object.defineProperty(navigator.serviceWorker, "ready", { value: Promise.resolve({ pushManager }) });
    },
    [permission, service] as const,
  );
}

test("Turn on asks the phone, once tapped, and gives the API the phone's push address", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.inbox = {
    ...fake.inbox,
    push_key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  };
  await phoneNotifications(page, "default", "takes");
  await page.goto("/alerts");
  await expect(page.getByText(copy.phoneOff)).toBeVisible();
  await page.getByRole("button", { name: copy.turnOn }).click();
  await expect(page.getByText(copy.phoneOff)).toHaveCount(0);
  expect(fake.pushSubscriptions).toEqual(["https://fcm.googleapis.com/fcm/send/test-phone"]);
});

test("says when the push service refuses, and Turn on can be tried again", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.inbox = {
    ...fake.inbox,
    push_key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  };
  await phoneNotifications(page, "default", "refuses");
  await page.goto("/alerts");
  await page.getByRole("button", { name: copy.turnOn }).click();
  await expect(page.getByRole("alert").filter({ hasText: copy.turnOnFailed })).toBeVisible();
  await expect(page.getByRole("button", { name: copy.turnOn })).toBeVisible();
  expect(fake.pushSubscriptions).toEqual([]);
});

test("says when the phone's settings block notifications", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.inbox = {
    ...fake.inbox,
    push_key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  };
  await phoneNotifications(page, "denied", "takes");
  await page.goto("/alerts");
  await expect(page.getByText(copy.blocked)).toBeVisible();
  await expect(page.getByRole("button", { name: copy.turnOn })).toHaveCount(0);
});

test("says a kind turned off with no signal was not saved, and keeps it on", async ({ page }) => {
  await fakeTech(page);
  await page.route("**/api/tech/alerts/settings", (route) => route.abort("internetdisconnected"));
  await page.goto("/alerts");
  const dayAhead = page.getByRole("switch", { name: copy.kinds.day_ahead.label });
  await dayAhead.click();
  await expect(page.getByRole("alert").filter({ hasText: copy.settingFailed })).toBeVisible();
  await expect(dayAhead).toHaveAttribute("aria-checked", "true");
});

test("a job of today's called off, read from a push, opens the dialog that says so", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.inbox = {
    ...fake.inbox,
    alerts: [alertOf({ kind: "job_cancelled", date: todayInIndia(), client_name: "Rohit M." })],
  };
  await page.goto("/");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: techCopy.interrupted.cancelled("Rohit M.") })).toBeVisible();
  await expect(dialog.getByText(techCopy.interrupted.cancelledAlert)).toBeVisible();
  await dialog.getByRole("button", { name: techCopy.interrupted.today }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a push read with the app open, of a job of today's called off, opens the dialog there and then", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await expect(bell(page)).toHaveAccessibleName(copy.bell(0));
  fake.inbox = {
    ...fake.inbox,
    alerts: [alertOf({ kind: "job_cancelled", date: todayInIndia(), client_name: "Rohit M." })],
  };
  // The worker, having shown the push, tells the open app.
  await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { kind: "mm-alerts" } }));
  });
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: techCopy.interrupted.cancelled("Rohit M.") }),
  ).toBeVisible();
});

test("a phone subscribed with a key since replaced subscribes again with the new one, as the app opens", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.inbox = {
    ...fake.inbox,
    push_key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  };
  await phoneNotifications(page, "granted", "held");
  await page.goto("/");
  await expect.poll(() => fake.pushSubscriptions).toEqual(["https://fcm.googleapis.com/fcm/send/test-phone"]);
  expect(await page.evaluate(() => document.documentElement.dataset.unsubscribed)).toBe("yes");
});
