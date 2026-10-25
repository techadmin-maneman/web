import { expect, test } from "../support.ts";
import { BOARD, fails, json, ROHIT, VIKRAM } from "./fixtures.ts";
import {
  MOVE_IT,
  READ_BOARD,
  ROHIT_BLOCK,
  listed,
  moveTo,
  ROHIT_JOB,
  open,
  press,
  reason,
  sentTo,
} from "./dispatch-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

test("draws the week, every technician and the jobs on their days", async ({ page }) => {
  await open(page);
  await expect(page.getByText("19 to 25 Sep")).toBeVisible();

  const grid = page.getByRole("table");
  await expect(grid.getByRole("columnheader")).toHaveText([
    "Fri 1964% bookedRoutes",
    "Sat 2092% booked, peak dayRoutes",
    "Sun 2188% booked, peak dayRoutes",
    "Mon 2258% bookedRoutes",
    "Tue 2364% bookedRoutes",
    "Wed 2461% bookedRoutes",
    "Thu 2567% bookedRoutes",
  ]);
  await expect(grid.getByRole("rowheader")).toHaveText([
    "Imran QureshiSec 40–65",
    "Sandeep YadavSec 1–39",
    "Arjun NegiDLF 1–5",
    "Faizan AliSohna Rd",
  ]);
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toContainText("Sec 65 · service");
  // Each block says when it starts, not only its window.
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toContainText("9 am");
  await expect(page.getByRole("button", { name: "Sanjay B., Sat 20 Sep, 9 am" })).toContainText("Sec 43 · first fit");
});

// "Block heights follow their slots, about 42, 63 and 84 px".
test("draws each job as tall as the slots it takes, so its size reads from its height", async ({ page }) => {
  await open(page);
  const heightOf = async (name: string) => (await page.getByRole("button", { name }).boundingBox())?.height ?? 0;

  const oneSlot = await heightOf(ROHIT_BLOCK);
  const slotAndAHalf = await heightOf("Kunal M., Tue 23 Sep, 12 pm");
  const twoSlots = await heightOf("Sanjay B., Sat 20 Sep, 9 am");

  expect(Math.abs(oneSlot - 42)).toBeLessThanOrEqual(1);
  expect(Math.abs(slotAndAHalf - 63)).toBeLessThanOrEqual(1);
  expect(Math.abs(twoSlots - 84)).toBeLessThanOrEqual(1);
});

test("marks the days a technician is away, and still shows the jobs already on them", async ({ page }) => {
  await open(page);
  // Faizan is away on the Sunday and the Monday, and holds a job on each.
  await expect(page.getByText("Faizan Ali is away on Sun 21 Sep")).toBeAttached();
  await expect(page.getByText("Faizan Ali is away on Mon 22 Sep")).toBeAttached();
  await expect(page.getByRole("button", { name: "Nitin R., Sun 21 Sep, 12 pm" })).toBeVisible();
  await expect(page.getByText("Faizan Ali is away on Tue 23 Sep")).toHaveCount(0);
  // The mark was named by an aria-label on a plain span, which ARIA forbids.
  await expect(page.locator("main span[aria-label]")).toHaveCount(0);
});

test("marks leave over part of a day with its hours, and not as a day away", async ({ page }) => {
  const sandeep = BOARD.technicians[1]?.technician_id ?? "";
  const part = { technician_id: sandeep, from: "2025-09-23", to: "2025-09-23", from_time: "14:00", to_time: "17:00" };
  await open(page, { [READ_BOARD]: json({ ...BOARD, leave: [...BOARD.leave, { ...part, note: null }] }) });
  await expect(page.getByText("Sandeep Yadav is away 2–5 pm on Tue 23 Sep")).toBeAttached();
  await expect(page.getByText("Sandeep Yadav is away on Tue 23 Sep")).toHaveCount(0);
});

// A visit is moved from its drawer to a technician's day from the list, then a start; the board is not dragged on.
test("says how much of a day the job takes, and lists only the technicians' days it would land on", async ({
  page,
}) => {
  await open(page);
  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");

  await expect(page.getByText("Moving Rohit M., service visit, 1 h 30 min.")).toBeVisible();
  const days = await listed(page).allInnerTexts();
  expect(days).toContain("Arjun Negi · Sun 21 Sep · from 9 am");
  expect(days).toContain("Faizan Ali · Tue 23 Sep · from 9 am");
  // Faizan is away on the Sunday, and Arjun's Tuesday has no room at all.
  expect(days.filter((day) => day.startsWith("Faizan Ali · Sun 21 Sep"))).toEqual([]);
  expect(days.filter((day) => day.startsWith("Arjun Negi · Tue 23 Sep"))).toEqual([]);
  // Nothing on the board is a drop target.
  await expect(page.getByRole("button", { name: /^Move Rohit Malhotra to / })).toHaveCount(0);

  // Sandeep's Saturday afternoon is full: his day's sheet offers the morning and the evening.
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");
  const starts = page.getByRole("dialog").getByLabel(opsCopy.dispatch.move.start).locator("option");
  await expect(starts).toHaveText(["9 am", "4 pm"]);
});

test("names leave when the server refuses a move onto a day off", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "on_leave") });
  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");
  await reason(page, "Client asked");
  await press(page, "Move and notify");

  await expect(page.getByRole("alert")).toHaveText("Sandeep Yadav is away on Sat 20 Sep.");
});

// The tray paired the offered day with the asked window, and named no client.
test("lists the tray’s jobs with their client, the window asked beside the one offered, and who invited them", async ({
  page,
}) => {
  await open(page);
  const tray = page.getByRole("complementary", { name: opsCopy.dispatch.tray.title });
  const first = tray.getByRole("listitem").first();
  await expect(first).toContainText("Vikram Sethi");
  await expect(first).toContainText(opsCopy.dispatch.typeNames.first_fit);
  // The client asked for a morning, on no recorded day, and is being offered a Saturday evening.
  await expect(first).toContainText("Asked for the morning");
  await expect(first).not.toContainText("Asked for Sat");
  await expect(first).toContainText("Offered Sat, evening");
  await expect(first).toContainText("Referred by Rohit Malhotra");
  // A visit with no Request behind it says so, rather than repeating the offered window.
  const last = tray.getByRole("listitem").last();
  await expect(last).toContainText(opsCopy.dispatch.tray.notAsked);
  await expect(last).toContainText("Offered Sun, afternoon");
});

// A tray click picked the job up at once, so it could not be read before it was assigned.
test("opens a tray job’s drawer, with the client, Assign and Open client", async ({ page }) => {
  await open(page);
  const job = page.getByRole("complementary", { name: opsCopy.dispatch.tray.title }).getByRole("button").first();
  await job.click();

  const drawer = page.getByRole("dialog", { name: "Vikram Sethi" });
  await expect(drawer).toContainText("Asked for the morning · Offered Sat, evening");
  await expect(drawer).toContainText("First fit · 3 h");
  await expect(drawer).toContainText("Sec 43 · 122018");
  await expect(drawer).toContainText("Rohit Malhotra");
  await expect(drawer.getByRole("button", { name: opsCopy.dispatch.drawer.assign })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "WhatsApp Vikram" })).toHaveAttribute(
    "href",
    "https://wa.me/919810000002",
  );
  await expect(drawer.getByRole("link", { name: opsCopy.dispatch.drawer.openClient })).toHaveAttribute(
    "href",
    `/clients/${VIKRAM.id}/visits`,
  );
  // Nothing is in hand until Assign is pressed.
  await expect(page.getByLabel(opsCopy.dispatch.landing.list)).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(job).toBeFocused();
});

// The drawer's badge, WhatsApp {client} and Open client.
test("opens a block’s drawer with the client, the badge, and both ways to reach them", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);

  const drawer = page.getByRole("dialog", { name: "Rohit Malhotra" });
  await expect(drawer).toContainText("Fri 19 Sep · 9 am · Imran Qureshi");
  await expect(drawer).toContainText(opsCopy.dispatch.drawer.badges.prepaid);
  await expect(drawer).toContainText("Service visit · 1 h 30 min");
  await expect(drawer).toContainText("Sec 65 · 122018");
  await expect(drawer).toContainText(opsCopy.dispatch.drawer.states.scheduled);
  await expect(drawer.getByRole("link", { name: "WhatsApp Rohit" })).toHaveAttribute(
    "href",
    "https://wa.me/919810000001",
  );
  await expect(drawer.getByRole("link", { name: opsCopy.dispatch.drawer.openClient })).toHaveAttribute(
    "href",
    `/clients/${ROHIT.id}/visits`,
  );

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toBeFocused();
});

// A building pin far from the door blocked the job, and ops had no way to let the technician in.
test("lets the technician check in to a visit today past the geofence, with a reason", async ({ page }) => {
  const startsAt = ROHIT_JOB?.starts_at ?? "";
  await page.clock.setFixedTime(new Date(Date.parse(startsAt) - 30 * 60_000));
  const sent = sentTo(page, `/api/visits/${ROHIT_JOB?.appointment_id ?? ""}/let-in`);
  await open(page, { [`POST /api/visits/${ROHIT_JOB?.appointment_id ?? ""}/let-in`]: json({ let_in: true }) });
  await press(page, ROHIT_BLOCK);
  await page
    .getByRole("dialog", { name: "Rohit Malhotra" })
    .getByRole("button", { name: opsCopy.dispatch.drawer.letIn })
    .click();

  const panel = page.getByRole("dialog", { name: "Allow Imran Qureshi to check in" });
  const confirm = panel.getByRole("button", { name: opsCopy.dispatch.drawer.letIn });
  await expect(confirm).toBeDisabled();
  await panel.getByRole("textbox", { name: opsCopy.dispatch.letIn.reason }).fill("The pin is at the society gate");
  await confirm.click();
  await expect(panel.getByRole("status")).toContainText("Imran Qureshi can check in now");
  expect(sent).toEqual([{ reason: "The pin is at the society gate" }]);
});

test("offers no way past the geofence for a visit on another day", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);
  await expect(
    page.getByRole("dialog", { name: "Rohit Malhotra" }).getByRole("button", { name: opsCopy.dispatch.drawer.letIn }),
  ).toHaveCount(0);
});

// The drawer and the picker are modal; nothing behind them takes the keyboard. Past the
// panel's last control the browser's own come next (the page's body holds focus), then the panel's first.
test("keeps the keyboard off the board behind an open panel", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);
  await expect(page.getByRole("dialog", { name: "Rohit Malhotra" })).toBeVisible();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    const behind = await page.evaluate(() => {
      const active = document.activeElement;
      const panel = document.querySelector("dialog[open]");
      return active !== null && active !== document.body && panel?.contains(active) !== true;
    });
    expect(behind, `Tab ${String(step + 1)} reached the board behind the drawer`).toBe(false);
  }
});

// The drawer said "Consultation · 1 slot" and nothing of what happened.
test("tells what happened on a visit in its drawer, step by step, and opens its photographs", async ({ page }) => {
  await open(page, {
    "GET /api/visits/{id}/story": json({
      steps: [
        { kind: "check_in", at: "2025-09-19T03:32:00.000Z", technician: "Imran Qureshi", outcome: null, door: null },
        {
          kind: "before_photos",
          at: "2025-09-19T03:40:00.000Z",
          technician: "Imran Qureshi",
          outcome: null,
          door: null,
        },
        { kind: "outcome", at: "2025-09-19T05:00:00.000Z", technician: "Imran Qureshi", outcome: "done", door: null },
      ],
    }),
  });
  await press(page, ROHIT_BLOCK);
  const story = page
    .getByRole("dialog", { name: "Rohit Malhotra" })
    .getByRole("region", { name: opsCopy.dispatch.drawer.story.title });
  await expect(story.getByRole("listitem")).toHaveText([
    "9:02 am" + (opsCopy.dispatch.drawer.story.steps.check_in ?? "") + " · Imran Qureshi",
    "9:10 am" + (opsCopy.dispatch.drawer.story.steps.before_photos ?? "") + " · Imran Qureshi",
    "10:30 am" + opsCopy.dispatch.drawer.story.step("Closed", "done") + " · Imran Qureshi",
  ]);
  await expect(story.getByRole("link", { name: opsCopy.dispatch.drawer.story.photos })).toHaveAttribute(
    "href",
    `/clients/${ROHIT.id}/photos`,
  );
});

// Arjun's closed consultation showed no state, Kabir's no-show vanished, and a proposed move left no mark.
test("marks each block done, not done, or with a move proposed, and keys the board beneath", async ({ page }) => {
  const [imran, ...others] = BOARD.technicians;
  const [day, ...days] = imran?.days ?? [];
  const [rohit, ...blocks] = day?.blocks ?? [];
  if (imran === undefined || day === undefined || rohit === undefined) throw new Error("the board has Rohit's visit");
  const marked = (status: "completed" | "terminated") => ({
    ...BOARD,
    technicians: [{ ...imran, days: [{ ...day, blocks: [{ ...rohit, status }, ...blocks] }, ...days] }, ...others],
  });
  await open(page, { [READ_BOARD]: json(marked("completed")) });
  const rohitDone = page.getByRole("button", { name: `${ROHIT_BLOCK}, done`, exact: true });
  await expect(rohitDone).toContainText(opsCopy.dispatch.chips.completed);
  await expect(page.getByRole("table").locator("caption")).toContainText(opsCopy.dispatch.legend.replacement);

  await open(page, { [READ_BOARD]: json(marked("terminated")) });
  const rohitNotDone = page.getByRole("button", { name: ROHIT_BLOCK, exact: true });
  await expect(rohitNotDone).toContainText(opsCopy.dispatch.chips.terminated);
});
