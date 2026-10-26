// The waves a person walks through on screen, with nothing faked but Turnstile and Razorpay's Checkout: a visitor
// booking on the site's /book, a client booking their next visit in the app and paying in Checkout (the run then
// sends the webhook Razorpay would), and a technician working a job on the technician app, once with the phone
// losing its signal mid-job and the outbox replaying when it comes back.

import { expect, type Page } from "@playwright/test";
import * as appCopy from "../../../apps/app/src/content.ts";
import {
  capture as captureWords,
  job as jobWords,
  notHome,
  signIn as signInWords,
  steps as stepWords,
} from "../../../apps/tech/src/content.ts";
import { referral } from "../../../site/src/content/referral.ts";
import * as siteCopy from "../../../site/src/content/site.ts";
import { Phone, razorpayPaid } from "../actors.ts";
import { appOf, idOf } from "./clients.ts";
import type { Job } from "./field.ts";
import { indiaDateOf, MINUTE } from "../sim.ts";
import { LOGIN_CODE } from "../stack.ts";
import { check } from "../steps.ts";
import { mobileFor, recordPaid, type Client, type Sim, type Technician } from "../world.ts";

/** A visitor books a free consultation on the site's /book, a pincode we serve, the first start offered. */
export async function siteBooking(sim: Sim, wave: string, pincode: string, city: string): Promise<void> {
  const phone = await Phone.open(sim.browser, sim.clock, sim.steps, "site");
  const name = "Tarun Oberoi";
  const mobile = mobileFor("8");
  await sim.steps.run(
    {
      wave,
      workflow: "Lead → consultation",
      app: "site",
      screen: "/book",
      action: `a visitor books on /book in ${pincode}`,
      mode: "ui",
    },
    async () => {
      const page = phone.page;
      await phone.go("/book");
      await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
      await page.getByLabel(siteCopy.tryOn.gate.name).fill(name);
      await page.getByLabel(siteCopy.tryOn.gate.mobile).fill(mobile);
      await page.getByRole("checkbox", { name: Object.values(referral.form.agree).join("") }).check();
      const kept = page.waitForResponse("**/api/lead");
      await page.getByRole("button", { name: siteCopy.booking.start }).click();
      check((await kept).status() === 201, "the lead was not kept");
      await page.getByLabel(referral.pincode.label).fill(pincode);
      await page.getByRole("button", { name: referral.pincode.check }).click();
      await expect(page.getByText(new RegExp(`^We come to `))).toBeVisible();
      await page.getByRole("button", { name: siteCopy.booking.next }).click();
      await page.getByLabel(referral.address.labels.flat).fill("Flat 402");
      await page.getByLabel(referral.address.labels.line1).fill("Palm Grove Society");
      await page.getByLabel(referral.address.labels.locality).fill("Sector 65");
      const answered = page.waitForResponse("**/api/consultation");
      await page.getByRole("button", { name: referral.consultation.submit }).click();
      const answer = await answered;
      check(answer.status() === 201, `/api/consultation answered ${String(answer.status())}`);
      await expect(page.getByText(referral.booked.label, { exact: true })).toBeVisible();
      sim.world.clients.push({
        name,
        mobile,
        city,
        pincode,
        cohort: Math.ceil(sim.clock.day / 7),
        fitted: false,
        erased: false,
        visits: [],
      });
    },
    { pages: [phone.page] },
  );
  await phone.close();
}

/** The client books their next service visit in the app, through the sheet's three steps and Checkout. */
export async function appBooking(sim: Sim, wave: string, client: Client): Promise<void> {
  const wire = await appOf(sim, client);
  if (wire === undefined) return;
  const phone = await Phone.open(sim.browser, sim.clock, sim.steps, "app");
  await sim.steps.run(
    {
      wave,
      workflow: "Booking: service (app screens)",
      app: "app",
      screen: "/visits › Book",
      action: `${client.name} books and pays in the app`,
      mode: "ui",
      allow: [401],
    },
    async () => {
      const page = phone.page;
      await phone.go("/");
      await page.getByRole("textbox", { name: appCopy.login.mobile.label }).fill(client.mobile);
      await page.getByRole("button", { name: appCopy.login.mobile.send }).click();
      await page.getByRole("textbox", { name: appCopy.login.code.label }).fill(LOGIN_CODE);
      await expect(page.getByRole("navigation").first()).toBeVisible();
      await page.getByRole("navigation").getByRole("link", { name: appCopy.titles.visits }).click();
      await page.getByRole("button", { name: appCopy.home.next.book }).click();
      const dates = page.getByRole("dialog", { name: appCopy.booking.date.title });
      await expect(dates.getByText(/^Step 1 of \d$/)).toBeVisible({ timeout: 15_000 });
      await dates.getByRole("radio").and(page.locator(":enabled")).nth(1).click();
      await dates.getByRole("button", { name: appCopy.booking.service.continue }).click();
      const windows = page.getByRole("dialog", { name: appCopy.booking.window.title });
      await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
      const held = page.waitForResponse(
        (answer) => answer.request().method() === "POST" && answer.url().endsWith("/api/holds"),
      );
      await windows.getByRole("button", { name: /^Continue( to payment)?$/ }).click();
      check((await held).ok(), "the window was not held");
      const pay = page.getByRole("dialog", { name: appCopy.booking.pay.title });
      await expect(pay.getByText(/^Held for \d+:\d\d$/)).toBeVisible();
      await pay.getByRole("checkbox", { name: Object.values(appCopy.booking.pay.agree).join("") }).check();
      const booked = page.waitForResponse(
        (answer) => answer.request().method() === "POST" && answer.url().endsWith("/api/bookings"),
      );
      await pay.getByRole("button", { name: /^Pay / }).click();
      const body = (await (await booked).json()) as {
        hold_id: string;
        checkout: { order_id: string; amount: number } | null;
      };
      if (body.checkout !== null) {
        const personId = client.id ?? (await idOf(sim, client)) ?? "";
        check(
          (await razorpayPaid(body.checkout, { hold_id: body.hold_id, person_id: personId })) === 200,
          "Razorpay's webhook was refused",
        );
        recordPaid(sim.world, indiaDateOf(sim.clock.now).slice(0, 7), body.checkout.amount);
      }
      await expect(page.getByText(appCopy.booking.confirmed.label, { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
    },
    { pages: [phone.page] },
  );
  await phone.close();
}

/** Signs the technician in on a phone of their own through the app's two screens. */
async function signInOnPhone(page: Page, technician: Technician): Promise<void> {
  await page.getByRole("textbox", { name: signInWords.mobileLabel }).fill(technician.mobile);
  await page.getByRole("button", { name: signInWords.sendCode }).click();
  await page.getByRole("textbox", { name: signInWords.codeLabel }).fill(LOGIN_CODE);
  await expect(page.getByRole("heading", { name: /jobs? today$|Nothing today|No jobs/i })).toBeVisible();
}

async function photograph(page: Page): Promise<void> {
  const take = page.getByRole("button", { name: captureWords.take });
  await expect(take).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) {
    await take.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }
  await page.getByRole("button", { name: captureWords.finish }).click();
}

/** The technician's phones, opened once and kept signed in, as their own phone is. */
const phones = new Map<string, Phone>();

async function phoneOf(sim: Sim, technician: Technician): Promise<Phone> {
  const held = phones.get(technician.id);
  if (held !== undefined) return held;
  const phone = await Phone.open(sim.browser, sim.clock, sim.steps, "tech");
  await phone.go("/");
  await signInOnPhone(phone.page, technician);
  phones.set(technician.id, phone);
  return phone;
}

/**
 * A service visit worked on the technician app's screens. With `offline`, the phone loses its signal once the job
 * has started: the steps go into the outbox, the clock moves on half an hour, the signal comes back, and the outbox
 * is replayed; the job must then read closed to ops, with every step landed once.
 */
export async function techJobOnScreen(
  sim: Sim,
  wave: string,
  technician: Technician,
  job: Job,
  offline = false,
): Promise<boolean> {
  const done = await sim.steps.run(
    {
      wave,
      workflow: offline ? "Offline outbox & replay" : "Field job (tech screens)",
      app: "tech",
      screen: `/jobs/${job.id}`,
      action: `${technician.name} works ${job.client_name ?? "a client"}'s ${job.type ?? "visit"} on the phone${offline ? ", signal lost mid-job" : ""}`,
      mode: "ui",
      allow: [401],
    },
    async () => {
      const phone = await phoneOf(sim, technician);
      const page = phone.page;
      await phone.go(`/jobs/${job.id}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      // A session lapses after its days, as on any phone: the technician signs in again.
      if (await page.getByRole("textbox", { name: signInWords.mobileLabel }).isVisible()) {
        await signInOnPhone(page, technician);
        await phone.go(`/jobs/${job.id}`);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      }
      await page.getByRole("button", { name: notHome.arrived.action }).click();
      await page.getByRole("button", { name: jobWords.start }).click();
      await expect(page.getByRole("heading", { level: 1, name: captureWords.before })).toBeVisible();
      if (offline) await phone.context.setOffline(true);
      await photograph(page);
      await expect(page.getByRole("heading", { level: 1, name: stepWords.titles.checklist })).toBeVisible();
      for (const item of await page.getByRole("listitem").getByRole("button").all()) await item.click();
      await page.getByRole("button", { name: stepWords.next }).click();
      await expect(page.getByRole("heading", { level: 1, name: stepWords.titles.consumables })).toBeVisible();
      // Counts left as the visit expects them say so on the button.
      await page
        .getByRole("button", { name: stepWords.consumables.asExpected })
        .or(page.getByRole("button", { name: stepWords.next }))
        .click();
      await expect(page.getByRole("heading", { level: 1, name: captureWords.after })).toBeVisible();
      await photograph(page);
      await expect(page.getByRole("heading", { level: 1, name: stepWords.titles.outcome })).toBeVisible();
      await page.getByRole("button", { name: captureWords.finish, exact: true }).click();
      await sim.clock.pass(Math.max(30, (job.minutes ?? 90) - 15) * MINUTE);
      await page.getByRole("button", { name: stepWords.next }).click();
      if (offline) {
        // Half an hour without signal, then back: the outbox replays in order.
        await sim.clock.pass(30 * MINUTE);
        await phone.context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
      }
      // The job reads closed to the server: the technician's own read of it, then ops'.
      const wire = technician.wire;
      check(wire !== undefined, "no wire for the technician");
      if (wire === undefined) return false;
      const deadline = Date.now() + 20_000;
      for (;;) {
        const card = await wire.must<{ status: string; progress: { outcome: string | null } }>(
          "GET",
          `/api/tech/jobs/${job.id}`,
        );
        if (card.status === "completed" || card.progress.outcome !== null) break;
        if (Date.now() > deadline)
          throw new Error(`the job still reads ${card.status} with no outcome after the phone's steps`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await expect(page.getByText(/· done$|Closed out · done/).first()).toBeVisible({ timeout: 15_000 });
      return true;
    },
    { pages: [], screen: () => phones.get(technician.id)?.page },
  );
  return done === true;
}
