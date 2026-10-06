import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { signIn } from "./signed-in.ts";
import { loggedIn } from "./profile-fixtures.ts";

test("opens from Home's button, with the client's name and a way back", async ({ page }) => {
  await loggedIn(page);
  await expect(page.getByRole("banner")).toContainText("Rohit Malhotra");
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
});

test("keeps the tabs at the foot of the screen, and scrolls only the page, however long it is", async ({ page }) => {
  await loggedIn(page);
  const tabs = await page.getByRole("navigation").boundingBox();
  expect((tabs?.y ?? 0) + (tabs?.height ?? 0)).toBe(844);
  const heights = await page.evaluate(() => ({
    document: document.documentElement.scrollHeight,
    page: document.querySelector("main")?.scrollHeight ?? 0,
  }));
  expect(heights.document).toBe(844);
  expect(heights.page).toBeGreaterThan(844);
});

test("shows the loading shape while the profile comes", async ({ page }) => {
  await signIn(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/profile", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeAttached();
  release();
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
});

test("takes an address and its access notes, and shows them", async ({ page }) => {
  await loggedIn(page);
  await expect(page.getByText("No address yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("Flat or house number").fill("House 4417");
  await page.getByLabel("Building, society or street").fill("Tower C");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByLabel("Access notes (optional)").fill("Gate code 4417 · park in visitor bay B");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("House 4417, Tower C, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("Gate code 4417 · park in visitor bay B")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit address and access notes" })).toBeVisible();

  // Home's consultation card now shows the address.
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByText("Sector 65, Gurgaon 122018")).toBeVisible();
});

// The building search (ADR 0054). The local API runs the stub provider, whose
// suggestions are synthetic Gurugram societies.
test("finds a building, keeps the flat separately, and shows the address as written", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();

  const search = page.getByRole("combobox", { name: "Search for your building" });
  await search.fill("Sunrise");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Sunrise Greens");
  // Google's condition for showing their suggestions without a Google map.
  await expect(page.getByText("Google Maps")).toBeVisible();
  await options.first().click();
  await expect(search).toHaveValue("Sunrise Greens");

  await page.getByLabel("Flat or house number").fill("Flat 1203");
  await page.getByLabel("Floor (optional)").fill("12");
  await page.getByLabel("Tower or block (optional)").fill("Tower C");
  await page.getByLabel("Landmark (optional)").fill("Opposite the sector market");
  // The chosen building is line one, so the free-text building field is gone.
  await expect(page.getByLabel("Building, society or street")).toBeHidden();
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Flat 1203, 12, Tower C, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
  // As the client typed it, under its own label, never "Near Opposite the sector market".
  await expect(page.getByText("Landmark", { exact: true })).toBeVisible();
  await expect(page.getByText("Opposite the sector market", { exact: true })).toBeVisible();
  await expect(page.getByText(/Near Opposite/)).toHaveCount(0);
});

test("the suggestion list works by keyboard alone", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();

  const search = page.getByRole("combobox", { name: "Search for your building" });
  await search.fill("Sec");
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(search).toHaveAttribute("aria-expanded", "true");

  await search.press("ArrowDown");
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowDown");
  await expect(page.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(search).toHaveValue("Mayfield Towers");
  await expect(page.getByRole("option")).toHaveCount(0);

  // Escape closes the list without choosing.
  await search.fill("Sec");
  await expect(page.getByRole("option")).toHaveCount(3);
  await search.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(search).toHaveAttribute("aria-expanded", "false");
});

test("an address can still be typed when the search gives nothing", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();

  // The stub answers this query with a 503, as a spent quota or an outage would.
  const search = page.getByRole("combobox", { name: "Search for your building" });
  await search.fill("mm-stub:down");
  await expect(page.getByText("Search isn’t available right now. Type your address below instead.")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);

  // Whatever is in the box stands as words: no suggestion was chosen, so no pin.
  await search.fill("Sunrise Greens");
  await page.getByLabel("Flat or house number").fill("House 4417");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("House 4417, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
});

test("refuses an address without a six-digit pincode", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("Flat or house number").fill("House 1");
  await page.getByLabel("Building, society or street").fill("Palm Grove Society");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("1220");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Fill in the flat or house number, the building or street, the area, the city and a six-digit pincode.",
  );
  // The field that is wrong is marked, named by the error, and given the focus.
  const pincode = page.getByLabel("Pincode");
  await expect(pincode).toHaveAttribute("aria-invalid", "true");
  await expect(pincode).toHaveAccessibleDescription(
    "Fill in the flat or house number, the building or street, the area, the city and a six-digit pincode.",
  );
  await expect(pincode).toBeFocused();
  await expect(page.getByLabel("City")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("City")).toHaveAttribute("required", "");
});

// FSM's work order must name the door (docs/open-points.md, item 45).
test("refuses an address without the flat or house number, and says so on the flat", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("Building, society or street").fill("Palm Grove Society");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Fill in the flat or house number, the building or street, the area, the city and a six-digit pincode.",
  );
  const flat = page.getByLabel("Flat or house number");
  await expect(flat).toHaveAttribute("aria-invalid", "true");
  await expect(flat).toHaveAttribute("required", "");
  await expect(flat).toBeFocused();
});

// Saved, the form closes on its own heading, so the client lands where they were rather than mid-page.
// An address the client gave ops on the phone, which ops saved for them (docs/decisions/0092-task-owners.md).
test("says an address was given to us on the phone, so the client can check it", async ({ page }) => {
  await signIn(page);
  // Only the browser resolves app.localhost, so the profile is answered whole rather than fetched and changed.
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({
      json: {
        name: "Rohit Malhotra",
        mobile: "+91 98xxx x4417",
        consents: [],
        number_change: null,
        number_change_decided: null,
        deletion: null,
        deletion_rejected: null,
        grievances: [],
        address: {
          line1: "Sunrise Greens",
          line2: null,
          locality: "Sector 65",
          city: "Gurgaon",
          pincode: "122018",
          access_notes: null,
          building: "Sunrise Greens",
          flat: "Flat 1203",
          floor: null,
          tower: null,
          landmark: null,
          place_id: null,
        },
        address_given_to_ops: "2026-09-21T06:30:00.000Z",
      },
    });
  });
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByText("Flat 1203, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("You gave us this address on the phone on 21 Sep 2026.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit address and access notes" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("lands on where we come once the address is saved", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("Flat or house number").fill("House 4417");
  await page.getByLabel("Building, society or street").fill("Palm Grove Society");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByRole("button", { name: "Save" }).click();
  const heading = page.getByRole("heading", { name: "Where we come" });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});
