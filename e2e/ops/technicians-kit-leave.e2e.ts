import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, json, LEAVE_RECORDED, NO_LEAVE, STOCK, type OpsReply } from "./fixtures.ts";
import {
  IMRAN,
  SANDEEP,
  LEAVE,
  CANCEL,
  READ_STOCK,
  IMRANS_LEAVE,
  SANDEEPS_LEAVE,
  RECORD_LEAVE,
  PHONE,
  answersWith,
  open,
  pageOf,
  backToRoster,
} from "./technicians-fixtures.ts";

const INK = "rgb(22, 35, 58)";

// ---- Their kit -------------------------------------------------------------------------------------------------

test("lists what his kit holds, marking what is low, with the way to Stock", async ({ page }) => {
  const kit = {
    ...STOCK,
    holdings: [
      { consumable_code: "tape_strips", technician_id: IMRAN, quantity: 3, low: true, counted_at: null },
      {
        consumable_code: "solvent",
        technician_id: IMRAN,
        quantity: 150,
        low: false,
        counted_at: "2027-09-20T06:00:00.000Z",
      },
      { consumable_code: "solvent", technician_id: SANDEEP, quantity: 40, low: false, counted_at: null },
    ],
  } satisfies OpsReply<"/api/stock">;
  await open(page, { [READ_STOCK]: json(kit) });
  const main = await pageOf(page, "Imran Qureshi", "Kit");

  const tape = main.getByRole("row").filter({ hasText: "Tape strips" });
  await expect(tape).toContainText("3 strip");
  await expect(tape).toContainText("Low");
  await expect(main.getByRole("row").filter({ hasText: "Solvent" })).toContainText("150 ml");
  await expect(main.getByRole("row").filter({ hasText: "Solvent" })).toContainText("Mon 20 Sep");
  await expect(main.getByText("40 ml")).toBeHidden();
  await expect(main.getByRole("link", { name: "Record a movement in Stock" })).toHaveAttribute("href", "/stock");
});

test("says so when his kit holds nothing on record", async ({ page }) => {
  await open(page, { [READ_STOCK]: json({ ...STOCK, holdings: [] }) });
  const main = await pageOf(page, "Faizan Ali", "Kit");
  await expect(main.getByText("Kit is empty.")).toBeVisible();
});

// ---- Leave ------------------------------------------------------------------------------------------------------

// Leave is recorded here (ADR 0062), and it is the same rows the dispatch board
// reads, so it says what it does before it is sent.
test("lists the leave a technician is down for, and says when there is none", async ({ page }) => {
  await open(page);
  const sandeep = await pageOf(page, "Sandeep Yadav", "Leave");
  await expect(sandeep.getByText("2 Oct 2027 to 6 Oct 2027")).toBeVisible();
  await expect(sandeep.getByText("Family wedding")).toBeVisible();
  await backToRoster(page);
  const imran = await pageOf(page, "Imran Qureshi", "Leave");
  await expect(imran.getByText("No leave recorded.")).toBeVisible();
});

// Reopened after one of three jobs had been moved, the panel showed the leave and not the two jobs still on it.
test("lists the jobs still booked on a leave each time the tab opens, each with the way to it on the board", async ({
  page,
}) => {
  await open(page);
  const main = await pageOf(page, "Sandeep Yadav", "Leave");
  const stranded = () => main.getByRole("listitem").filter({ hasText: "2 Oct 2027 to 6 Oct 2027" });
  await expect(stranded()).toContainText("1 job is still booked on these days. Move it on the board.");
  await expect(stranded()).toContainText("Mon 4 Oct, 10:30 am · Rohit Malhotra");
  await expect(
    stranded().getByRole("link", { name: "Show on board: Mon 4 Oct, 10:30 am · Rohit Malhotra" }),
  ).toHaveAttribute("href", "/dispatch?from=2027-10-04&find=Sandeep+Yadav&visit=22000000-0000-4000-8000-000000000001");

  await main.getByRole("link", { name: "Phones", exact: true }).click();
  await main.getByRole("link", { name: "Leave", exact: true }).click();
  await expect(stranded()).toContainText("Mon 4 Oct, 10:30 am · Rohit Malhotra");
});

test("records leave, saying first that nobody can be booked on those days, and shows it at once", async ({ page }) => {
  await open(page);
  const main = await pageOf(page, "Imran Qureshi", "Leave");
  await main.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  // The form takes the keyboard as it opens, where the button stood.
  await expect(main.getByLabel("First day")).toBeFocused();
  // A routine entry, drawn as every other save is, not as a danger.
  await expect(main.getByRole("button", { name: "Record" })).toHaveCSS("background-color", INK);

  await main.getByLabel("First day").fill("2027-10-12");
  await main.getByLabel("Last day").fill("2027-10-14");
  await main.getByLabel("Note (optional)").fill("Away");

  // Their leave is read again, with the new period and the job it falls on.
  const recorded = {
    leave: [
      {
        id: LEAVE_RECORDED.id,
        from: "2027-10-12",
        to: "2027-10-14",
        note: "Away",
        jobs: [
          {
            appointment_id: "22000000-0000-4000-8000-000000000002",
            starts_at: "2027-10-13T05:00:00.000Z",
            type: "service",
            client: "Rohit Malhotra",
          },
        ],
      },
    ],
  } satisfies OpsReply<"/api/technicians/{id}/leave">;
  await answer(page, answersWith({ [IMRANS_LEAVE]: json(recorded) }));
  const sent = page.waitForRequest((request) => request.url().endsWith(LEAVE) && request.method() === "POST");
  await main.getByRole("button", { name: "Record" }).click();
  expect((await sent).postDataJSON()).toEqual({ from: "2027-10-12", to: "2027-10-14", note: "Away" });

  await expect(main.getByRole("status")).toHaveText("Leave recorded.");
  const period = main.getByRole("listitem").filter({ hasText: "12 Oct 2027 to 14 Oct 2027" });
  await expect(period).toContainText("1 job is still booked on these days. Move it on the board.");
  await expect(period).toContainText("Wed 13 Oct, 10:30 am · Rohit Malhotra");
});

test("says so when the dates do not make a period, and records nothing", async ({ page }) => {
  await open(page, { [RECORD_LEAVE]: fails(400, "invalid_request") });
  const main = await pageOf(page, "Imran Qureshi", "Leave");
  await main.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  await main.getByLabel("First day").fill("2027-10-14");
  await main.getByLabel("Last day").fill("2027-10-12");
  await main.getByRole("button", { name: "Record" }).click();

  await expect(main.getByRole("alert")).toContainText("The last day must follow the first");
});

// Taking leave back put a technician into the booking pool at once, with no check, unlike every other change.
test("takes leave back only once asked, saying he can be booked on those days again", async ({ page }) => {
  await open(page);
  const main = await pageOf(page, "Sandeep Yadav", "Leave");
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posted.push(request.url());
  });

  await main.getByRole("button", { name: "Cancel Sandeep Yadav's leave, 2 Oct 2027 to 6 Oct 2027" }).click();
  const check = main.getByRole("group", { name: "Cancel leave, 2 Oct 2027 to 6 Oct 2027?" });
  await expect(check).toContainText("They can be booked on those days again.");
  await check.getByRole("button", { name: "Keep leave" }).click();
  await expect(check).toBeHidden();
  expect(posted).toEqual([]);

  await main.getByRole("button", { name: "Cancel Sandeep Yadav's leave, 2 Oct 2027 to 6 Oct 2027" }).click();
  await answer(page, answersWith({ [SANDEEPS_LEAVE]: json(NO_LEAVE) }));
  const sent = page.waitForRequest((request) => request.url().endsWith(CANCEL) && request.method() === "POST");
  await main.getByRole("button", { name: "Cancel leave" }).click();
  await sent;
  await expect(main.getByText("No leave recorded.")).toBeVisible();
});

test("meets WCAG 2.2 AA on the roster and the page, with a revoke, the leave form and its check open", async ({
  page,
}) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  const main = await pageOf(page, "Imran Qureshi", "Phones");
  await main.getByRole("button", { name: PHONE }).click();
  expect(await axeViolations(page)).toEqual([]);

  await main.getByRole("link", { name: "Leave", exact: true }).click();
  await main.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  expect(await axeViolations(page)).toEqual([]);

  await backToRoster(page);
  const sandeep = await pageOf(page, "Sandeep Yadav", "Leave");
  await sandeep.getByRole("button", { name: "Cancel Sandeep Yadav's leave, 2 Oct 2027 to 6 Oct 2027" }).click();
  expect(await axeViolations(page)).toEqual([]);
});
