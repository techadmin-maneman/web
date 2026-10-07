import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, BOARD, fails, json, ROHIT, ROOM } from "./fixtures.ts";
import {
  BOARD_PATH,
  READ_BOARD,
  READ_ROOM,
  MOVE_IT,
  ROHIT_BLOCK,
  TO_SANDEEP,
  ROHIT_JOB,
  open,
  press,
} from "./dispatch-fixtures.ts";

// The brief's "city and week picker"; the route took both, and the board sent neither.
test("moves between weeks and cities, asking the route for each", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === BOARD_PATH) asked.push(url.search);
  });
  await open(page);

  await page.getByRole("button", { name: "Next week" }).click();
  await expect.poll(() => asked.at(-1)).toBe("?from=2025-09-26");
  await page.getByLabel("City", { exact: true }).selectOption("Delhi");
  await expect.poll(() => asked.at(-1)).toBe("?from=2025-09-26&city=Delhi");
  await page.getByRole("button", { name: "This week" }).click();
  await expect.poll(() => asked.at(-1)).toBe("?city=Delhi");
});

// A technician's page shows their days by linking here with the week and their name.
test("opens on the week and the search a link asks for", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === BOARD_PATH) asked.push(url.search);
  });
  await answer(page, { [READ_BOARD]: json(BOARD), [READ_ROOM]: json(ROOM) });
  await page.goto("/dispatch?from=2025-09-19&find=Sohna");

  await expect(page.getByLabel("Find a technician, client or area")).toHaveValue("Sohna");
  await expect(page.getByRole("rowheader")).toHaveText(["Faizan AliSohna Rd"]);
  await expect.poll(() => asked[0]).toBe("?from=2025-09-19");
});

// "Move in Dispatch" landed on this week's bare board, and Back from a client reset it.
test("opens the visit a link names, in its drawer, on the week the link asks for", async ({ page }) => {
  await answer(page, { [READ_BOARD]: json(BOARD), [READ_ROOM]: json(ROOM) });
  await page.goto(`/dispatch?from=2025-09-19&visit=${ROHIT_JOB?.appointment_id ?? ""}`);

  await expect(page.getByRole("dialog", { name: "Rohit Malhotra" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toBeFocused();
  await expect(page).toHaveURL(/\/dispatch\?from=2025-09-19$/);
});

test("keeps its week, city, search and open visit in the address, so Back from a client finds it as it was", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Next week" }).click();
  await page.getByLabel("City", { exact: true }).selectOption("Delhi");
  await page.getByLabel("Find a technician, client or area").fill("Rohit");
  await press(page, ROHIT_BLOCK);
  const kept = `?from=2025-09-26&city=Delhi&find=Rohit&visit=${ROHIT_JOB?.appointment_id ?? ""}`;
  await expect.poll(() => new URL(page.url()).search).toBe(kept);

  await page.getByRole("dialog").getByRole("link", { name: "Open client" }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${ROHIT.id}/visits$`));
  await page.goBack();

  await expect(page.getByRole("dialog", { name: "Rohit Malhotra" })).toBeVisible();
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("Delhi");
  await expect(page.getByLabel("Find a technician, client or area")).toHaveValue("Rohit");
});

// 168 technicians made a board 15,000 px tall whose day headers scrolled away, with no way to find a row.
test("keeps its header row and technicians' column in place, and finds a row by name, zone or client", async ({
  page,
}) => {
  await open(page);
  const position = (element: HTMLElement) => getComputedStyle(element).position;
  expect(await page.getByRole("columnheader").first().evaluate(position)).toBe("sticky");
  expect(await page.getByRole("rowheader").first().evaluate(position)).toBe("sticky");

  const find = page.getByLabel("Find a technician, client or area");
  await find.fill("Sohna");
  await expect(page.getByRole("rowheader")).toHaveText(["Faizan AliSohna Rd"]);
  await find.fill("kabir");
  await expect(page.getByRole("rowheader")).toHaveText(["Arjun NegiDLF 1–5"]);
  await find.fill("nobody");
  await expect(page.getByText("Nothing this week matches “nobody”.")).toBeVisible();
});

// An area on a block found nothing, and a client found left a row of eight with no sign of theirs.
test("finds a visit by its area or its client, and outlines the blocks it found", async ({ page }) => {
  await open(page);
  const find = page.getByLabel("Find a technician, client or area");
  const found = page.locator("[data-match]");

  await find.fill("dlf 4");
  await expect(page.getByRole("rowheader")).toHaveCount(2);
  await expect(found).toHaveCount(2);
  await expect(found.first()).toHaveAccessibleName("Vikram S., Fri 19 Sep, afternoon");

  await find.fill("Sanjay");
  await expect(found).toHaveCount(1);
  await expect(found).toHaveAccessibleName("Sanjay B., Sat 20 Sep, morning");

  // A technician found by name has no one block to point at.
  await find.fill("Faizan");
  await expect(page.getByRole("rowheader")).toHaveCount(1);
  await expect(found).toHaveCount(0);
});

// An empty tray kept its 236 px, so a 1024 px laptop showed five of the week's seven days.
test("folds an empty tray to a rail, so the week has the width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, { [READ_BOARD]: json({ ...BOARD, unassigned: [] }) });
  const tray = page.getByRole("complementary", { name: "Unassigned" });
  expect((await tray.boundingBox())?.width ?? 0).toBeLessThanOrEqual(41);
  await expect(tray).toContainText("Nothing unassigned.");
});

// At 1280 wide and 200% zoom the days shrank to 15 px and the navigation ran off the page.
test("keeps every day readable, and the navigation in reach, at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await open(page);
  for (const head of await page.getByRole("columnheader").all()) {
    expect((await head.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(96);
  }
  const settings = page.getByRole("link", { name: "Settings" });
  await settings.scrollIntoViewIfNeeded();
  await expect(settings).toBeInViewport();
});

test("meets WCAG 2.2 AA on the board, the drawer, a job in hand, the picker and a refusal", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "clash") });
  expect(await axeViolations(page)).toEqual([]);

  await press(page, ROHIT_BLOCK);
  await expect(page.getByRole("dialog", { name: "Rohit Malhotra" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await press(page, "Move visit");
  await expect(page.getByLabel("Or choose from a list")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await press(page, TO_SANDEEP);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("radio", { name: "Earlier job running over" }).check();
  await page.getByRole("button", { name: "Move and notify" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("Escape lets go of the picker, then of the move itself", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await press(page, TO_SANDEEP);
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Moving Rohit M.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("Moving Rohit M.")).toBeHidden();
});
