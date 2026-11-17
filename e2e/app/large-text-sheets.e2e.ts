// The client app's sheets and the visit's day on Home, held at 390 and 360 px and at 360 with its text at 130%
// (./text-sizes.ts; docs/prompts/client-redesign.md, "Acceptance"): a note, a rating's thanks low and high, the invite's
// card, its preview and a share that failed; and the live card at each stage of the day, its move proposed, its sign-off
// asked beside today's after photos, put in words and sent.
// Every answer that moves the visit through its day is faked, so no test changes what another reads.

import type { Locator, Page } from "@playwright/test";
import { addDays, indiaDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { passedThrough } from "./booking-fixtures.ts";
import { holds, named, signedIn, SIZES } from "./text-sizes.ts";
import { home, live, note, refer, visits } from "../../apps/app/src/content.ts";

type Visit = Record<string, unknown>;

const TECHNICIAN = "Imran";
const MINUTE_MS = 60_000;

/** The sign-off of a fit, asked for and not yet given, as the live card reads it. */
const SIGN_OFF_ASKED = {
  state: "asked",
  checks: null,
  flag_text: null,
  declined_reason: null,
  asked_at: new Date().toISOString(),
  asks: 1,
  signed_at: null,
  guarantee_days: null,
} as const;

/** A fit under way today, at its last step. */
const FITTING = { type: "replacement", status: "in_progress", stage: "in_progress", latest_update: null } as const;

/**
 * Each stage of the visit's day: the next visit as the API would answer it then, and what Home says of it. The sign-off
 * is asked on `photographed`, a visit with after photos, which the panel shows beside its checks.
 */
function stagesOfTheDay(
  page: Page,
  photographed: string,
): { name: string; visit: (each: Visit) => Visit; says: Locator }[] {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const today = indiaDate(at);
  const shown = (words: string) => page.getByText(words, { exact: true }).first();
  return [
    { name: "today", visit: (each) => each, says: shown(live.setsOff(TECHNICIAN)) },
    {
      name: "a move proposed",
      visit: (each) => ({
        ...each,
        proposed_move: {
          id: "6a000000-0000-4000-8000-000000000001",
          date: "2099-01-06",
          window: "morning",
          hours: { start: "09:00", end: "12:00" },
          technician: { name: "Sameer Bhatt", initials: "SB" },
          expires_at: "2099-01-05T06:30:00.000Z",
        },
      }),
      says: page.getByRole("button", { name: home.proposal.pick }),
    },
    {
      name: "on the way",
      visit: (each) => ({ ...each, latest_update: { kind: "on_the_way", minutes: 12, at } }),
      says: shown(live.onTheWay(TECHNICIAN)),
    },
    {
      name: "running late",
      visit: (each) => ({
        ...each,
        arrives_by: new Date(now - 60 * MINUTE_MS).toISOString(),
        latest_update: { kind: "running_late", minutes: 15, at },
      }),
      says: shown(live.runningLate(TECHNICIAN)),
    },
    {
      name: "at the gate",
      visit: (each) => ({ ...each, latest_update: { kind: "at_the_gate", minutes: null, at } }),
      says: shown(live.atTheGate(TECHNICIAN)),
    },
    {
      name: "arrived",
      visit: (each) => ({ ...each, stage: "arrived", latest_update: null }),
      says: shown(live.atTheDoor(TECHNICIAN)),
    },
    {
      name: "in progress",
      visit: (each) => ({ ...each, ...FITTING, step: { index: 2, of: 4, name: "service" } }),
      says: shown(live.inProgress),
    },
    {
      name: "the sign-off asked",
      visit: (each) => ({
        ...each,
        ...FITTING,
        id: photographed,
        step: { index: 5, of: 5, name: "sign_off" },
        sign_off: SIGN_OFF_ASKED,
      }),
      says: page.getByText(live.signOff.photos),
    },
    {
      name: "the sign-off sent back",
      visit: (each) => ({
        ...each,
        ...FITTING,
        step: { index: 5, of: 5, name: "sign_off" },
        sign_off: { ...SIGN_OFF_ASKED, state: "flagged", flag_text: "The left edge lifts at the temple." },
      }),
      says: shown(live.signOff.sent(TECHNICIAN)),
    },
    { name: "done", visit: (each) => ({ ...each, stage: "done", step: null }), says: shown(live.done) },
    {
      name: "closing",
      visit: (each) => ({ ...each, status: "in_progress", stage: "closing" }),
      says: shown(live.closing),
    },
    {
      name: "not home",
      visit: (each) => ({ ...each, status: "in_progress", stage: "closing", not_home: true }),
      says: shown(live.notHome),
    },
    {
      name: "missed",
      visit: (each) => ({ ...each, date: addDays(today, -1), status: "scheduled", stage: "missed" }),
      says: shown(live.missed),
    },
  ];
}

for (const size of SIZES) {
  test(`a note, a rating's thanks and the invite hold at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    const fitted = await signedIn(page);
    // A note already left for the technician, as the sheet opens on it, whatever other tests have left.
    await passedThrough(page, `**/api/visits/${fitted.next.id}`, (visit: Record<string, unknown>) =>
      "client_note" in visit
        ? { ...visit, client_note: "The lift is out, so call from the gate and I will come down to meet you." }
        : visit,
    );
    await page.goto(`/visits/${fitted.next.id}`);
    await page.getByRole("button", { name: home.note }).click();
    await expect(page.getByRole("dialog").getByRole("textbox", { name: note.label })).toBeVisible();
    await holds(page, size, "note");

    // A rating, given in the API's place, low then high: each one's thanks, the low one's with the way to say what
    // went wrong. The visit is read unrated again each time, the rating never stored.
    const rating = visits.detail.rating;
    await page.route(`**/api/visits/${fitted.service.id}/rating`, async (route) => {
      const { stars } = route.request().postDataJSON() as { stars: number };
      await route.fulfill({ status: 201, json: { stars, at: new Date().toISOString(), low: stars < 4 } });
    });
    for (const [stars, thanks] of [
      [3, rating.low],
      [5, rating.thanks],
    ] as const) {
      await page.goto(`/visits/${fitted.service.id}`);
      await page
        .getByRole("group", { name: rating.label })
        .getByRole("button", { name: rating.star(stars) })
        .click();
      await expect(page.getByText(thanks)).toBeVisible();
      await holds(page, size, `rating of ${String(stars)}`);
    }

    // The invite's card, and its preview with the house card, which writes nothing for this client.
    await page.goto("/rewards");
    await page.getByRole("button", { name: refer.inviteOnWhatsApp }).click();
    const card = page.getByRole("dialog", { name: refer.card.title });
    await expect(card).toBeVisible();
    await holds(page, size, "invite's card");
    await card.getByRole("radio", { name: refer.card.house.name }).click();
    await card.getByRole("button", { name: refer.card.next }).click();
    const preview = page.getByRole("dialog", { name: refer.preview.title });
    await expect(preview.getByRole("link", { name: refer.preview.whatsapp })).toBeVisible();
    await holds(page, size, "invite's preview");
    // A way to send it that fails, as a phone that will not copy: the preview says nothing was sent.
    await page.evaluate(() => {
      navigator.clipboard.writeText = () =>
        Promise.reject(new DOMException("The page may not write to the clipboard.", "NotAllowedError"));
    });
    await preview.getByRole("button", { name: refer.preview.copy }).click();
    await expect(preview.getByRole("alert")).toContainText(refer.preview.failed.line);
    await holds(page, size, "invite's share failed");
  });

  test(`the visit's day on Home holds at ${named(size)}, at every stage`, async ({ page }) => {
    test.setTimeout(180_000);
    // The next visit answered as on its day, as each stage has it; an answer with no visit is left as it was.
    let stage: (each: Visit) => Visit = (each) => each;
    await passedThrough(page, "**/api/me", (me: Record<string, unknown>) =>
      typeof me.next_visit === "object" && me.next_visit !== null
        ? { ...me, next_visit: stage({ ...me.next_visit, date: indiaDate(new Date().toISOString()) }) }
        : me,
    );
    const fitted = await signedIn(page);
    for (const each of stagesOfTheDay(page, fitted.service.id)) {
      stage = each.visit;
      await page.reload();
      await expect(each.says).toBeVisible();
      await holds(page, size, each.name);
      if (each.name !== "the sign-off asked") continue;
      // What isn't right, put in the client's own words.
      await page.getByRole("button", { name: live.signOff.checks.hairline }).click();
      await page.getByRole("button", { name: live.signOff.notRight }).click();
      await expect(page.getByRole("textbox", { name: live.signOff.whatsWrong })).toBeVisible();
      await holds(page, size, "the sign-off, what isn't right");
    }
  });
}
