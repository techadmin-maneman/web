import { expect, test } from "../support.ts";
import { fails, json, ROHIT, VIKRAM } from "./fixtures.ts";
import { MOVE_IT, ROHIT_BLOCK, TO_SANDEEP, ROHIT_JOB, open, press, reason, sentTo } from "./dispatch-fixtures.ts";

test("draws the week, every technician and the jobs on their days", async ({ page }) => {
  await open(page);
  await expect(page.getByText("19 to 25 Sep")).toBeVisible();

  const grid = page.getByRole("table");
  await expect(grid.getByRole("columnheader")).toHaveText([
    "Fri 1964%",
    "Sat 2092%",
    "Sun 2188%",
    "Mon 2258%",
    "Tue 2364%",
    "Wed 2461%",
    "Thu 2567%",
  ]);
  await expect(grid.getByRole("rowheader")).toHaveText([
    "Imran QureshiSec 40–65",
    "Sandeep YadavSec 1–39",
    "Arjun NegiDLF 1–5",
    "Faizan AliSohna Rd",
  ]);
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toContainText("Sec 65 · service");
  // Each block says when it starts, not only its window.
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toContainText("9:00");
  await expect(page.getByRole("button", { name: "Sanjay B., Sat 20 Sep, morning" })).toContainText(
    "Sec 43 · first fit",
  );
});

// "Block heights follow their slots, about 42, 63 and 84 px".
test("draws each job as tall as the slots it takes, so its size reads from its height", async ({ page }) => {
  await open(page);
  const heightOf = async (name: string) => (await page.getByRole("button", { name }).boundingBox())?.height ?? 0;

  const oneSlot = await heightOf(ROHIT_BLOCK);
  const slotAndAHalf = await heightOf("Kunal M., Tue 23 Sep, afternoon");
  const twoSlots = await heightOf("Sanjay B., Sat 20 Sep, morning");

  expect(Math.abs(oneSlot - 42)).toBeLessThanOrEqual(1);
  expect(Math.abs(slotAndAHalf - 63)).toBeLessThanOrEqual(1);
  expect(Math.abs(twoSlots - 84)).toBeLessThanOrEqual(1);
});

test("marks the days a technician is away, and still shows the jobs already on them", async ({ page }) => {
  await open(page);
  // Faizan is away on the Sunday and the Monday, and holds a job on each.
  await expect(page.getByText("Faizan Ali is away on Sun 21 Sep")).toBeAttached();
  await expect(page.getByText("Faizan Ali is away on Mon 22 Sep")).toBeAttached();
  await expect(page.getByRole("button", { name: "Nitin R., Sun 21 Sep, afternoon" })).toBeVisible();
  await expect(page.getByText("Faizan Ali is away on Tue 23 Sep")).toHaveCount(0);
  await expect(page.getByText("Leave is recorded on Technicians")).toBeVisible();
  // The mark was named by an aria-label on a plain span, which ARIA forbids.
  await expect(page.locator("main span[aria-label]")).toHaveCount(0);
});

// The brief: "Drop it on a cell with room", with "a hint that shows its slot size".
test("says how much of a day the job takes, and offers only the windows it would land in", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");

  await expect(page.getByText("Moving Rohit M., service visit, 1 slot.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move Rohit M. to Arjun Negi, Sun 21 Sep, morning" })).toBeVisible();
  // Faizan is away on the Sunday; Sandeep's Saturday afternoon is full.
  await expect(page.getByRole("button", { name: /Move Rohit M\. to Faizan Ali, Sun 21 Sep/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Move Rohit M\. to Faizan Ali, Tue 23 Sep/ })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Move Rohit M. to Sandeep Yadav, Sat 20 Sep, afternoon" })).toHaveCount(
    0,
  );
  // Arjun's Tuesday has no room at all, and says so.
  const arjun = page.getByRole("row", { name: /Arjun Negi/ });
  await expect(arjun.getByRole("cell").nth(4)).toHaveText("No room");
});

test("names leave when the server refuses a move onto a day off", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "on_leave") });
  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await press(page, TO_SANDEEP);
  await reason(page, "Zone rebalance");
  await press(page, "Move and notify");

  await expect(page.getByRole("alert")).toHaveText("Sandeep Yadav is away on Sat 20 Sep.");
});

// The tray paired the offered day with the asked window, and named no client.
test("lists the tray's jobs with their client, the window asked beside the one offered, and who invited them", async ({
  page,
}) => {
  await open(page);
  const tray = page.getByRole("complementary", { name: "Unassigned" });
  const first = tray.getByRole("listitem").first();
  await expect(first).toContainText("Vikram Sethi");
  await expect(first).toContainText("First fit");
  // The client asked for a morning, on no recorded day, and is being offered a Saturday evening.
  await expect(first).toContainText("Asked · morning");
  await expect(first).not.toContainText("Asked · Sat");
  await expect(first).toContainText("Offered · Sat, evening");
  await expect(first).toContainText("Referred by Rohit Malhotra");
  // A visit with no Request behind it says so, rather than repeating the offered window.
  const last = tray.getByRole("listitem").last();
  await expect(last).toContainText("Asked · not recorded");
  await expect(last).toContainText("Offered · Sun, afternoon");
  await expect(tray.getByText("“Asked” is the window the client picked")).toBeVisible();
});

// A tray click picked the job up at once, so it could not be read before it was assigned.
test("opens a tray job's drawer, with the client, Assign and Open client", async ({ page }) => {
  await open(page);
  const job = page.getByRole("complementary", { name: "Unassigned" }).getByRole("button").first();
  await job.click();

  const drawer = page.getByRole("dialog", { name: "Vikram Sethi" });
  await expect(drawer).toContainText("Asked · morning · Offered · Sat, evening");
  await expect(drawer).toContainText("First fit · 2 slots");
  await expect(drawer).toContainText("Sec 43 · 122018");
  await expect(drawer).toContainText("Rohit Malhotra");
  await expect(drawer.getByRole("button", { name: "Assign to a technician" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "WhatsApp Vikram" })).toHaveAttribute(
    "href",
    "https://wa.me/919810000002",
  );
  await expect(drawer.getByRole("link", { name: "Open client" })).toHaveAttribute(
    "href",
    `/clients/${VIKRAM.id}/visits`,
  );
  // Nothing is in hand until Assign is pressed.
  await expect(page.getByRole("button", { name: /^Move Vikram S. to / })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(job).toBeFocused();
});

// The drawer's badge, WhatsApp {client} and Open client.
test("opens a block's drawer with the client, the badge, and both ways to reach him", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);

  const drawer = page.getByRole("dialog", { name: "Rohit Malhotra" });
  await expect(drawer).toContainText("Fri 19 Sep · 9 am to 12 pm · Imran Qureshi");
  await expect(drawer).toContainText("Prepaid");
  await expect(drawer).toContainText("Service visit · 1 slot");
  await expect(drawer).toContainText("Sec 65 · 122018");
  await expect(drawer).toContainText("Scheduled");
  await expect(drawer.getByRole("link", { name: "WhatsApp Rohit" })).toHaveAttribute(
    "href",
    "https://wa.me/919810000001",
  );
  await expect(drawer.getByRole("link", { name: "Open client" })).toHaveAttribute(
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
  await page.getByRole("dialog", { name: "Rohit Malhotra" }).getByRole("button", { name: "Allow check-in" }).click();

  const panel = page.getByRole("dialog", { name: "Allow Imran Qureshi to check in" });
  const confirm = panel.getByRole("button", { name: "Allow check-in" });
  await expect(confirm).toBeDisabled();
  await panel.getByRole("textbox", { name: "Reason" }).fill("The pin is at the society gate");
  await confirm.click();
  await expect(panel.getByRole("status")).toContainText("Imran Qureshi can check in now");
  expect(sent).toEqual([{ reason: "The pin is at the society gate" }]);
});

test("offers no way past the geofence for a visit on another day", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);
  await expect(
    page.getByRole("dialog", { name: "Rohit Malhotra" }).getByRole("button", { name: "Allow check-in" }),
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
