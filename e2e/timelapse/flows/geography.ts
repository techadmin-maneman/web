// Geography: cities opened from India Post's pincodes, pincodes served and launched, and technicians to go there.
// Day 1 opens Gurgaon and Delhi; day 45 adds Noida; day 90 opens Mumbai; day 135 Bengaluru. Each wave walks the
// Areas page's own panels, then checks what the site and the app offer for the pincodes it opened.

import { expect, type Page } from "@playwright/test";
import { areas as areasCopy } from "../../../apps/ops/src/content/areas.ts";
import * as opsCopy from "../../../apps/ops/src/content.ts";
import { randomUUID } from "node:crypto";
import { Wire, techSignIn } from "../actors.ts";
import { dateOf } from "../sim.ts";
import { check } from "../steps.ts";
import { sees } from "../ui.ts";
import { mobileFor, type Sim, type Technician } from "../world.ts";

interface CityPlan {
  readonly city: string;
  readonly state: string;
  readonly district: string;
  /** How many of the district's pincodes go live now; the rest wait, unserved, for a later launch. */
  readonly serve: number;
  readonly technicians: readonly { name: string; fits: boolean }[];
}

export const OPENINGS: Readonly<Record<number, readonly CityPlan[]>> = {
  1: [
    {
      city: "Gurgaon",
      state: "HARYANA",
      district: "GURUGRAM",
      serve: 12,
      technicians: [
        { name: "Imran Qureshi", fits: true },
        { name: "Sunil Rawat", fits: false },
      ],
    },
    {
      city: "Delhi",
      state: "DELHI",
      district: "SOUTH",
      serve: 12,
      technicians: [
        { name: "Ravi Kumar", fits: true },
        { name: "Deepak Negi", fits: false },
      ],
    },
  ],
  45: [
    {
      city: "Noida",
      state: "UTTAR PRADESH",
      district: "GAUTAM BUDDHA NAGAR",
      serve: 8,
      technicians: [
        { name: "Aman Tyagi", fits: true },
        { name: "Mohit Bhati", fits: false },
      ],
    },
  ],
  90: [
    {
      city: "Mumbai",
      state: "MAHARASHTRA",
      district: "MUMBAI",
      serve: 8,
      technicians: [{ name: "Sameer Shaikh", fits: true }],
    },
  ],
  135: [
    {
      city: "Bengaluru",
      state: "KARNATAKA",
      district: "BENGALURU URBAN",
      serve: 6,
      technicians: [{ name: "Kiran Gowda", fits: true }],
    },
  ],
};

/** India Post's district names are upper case; the page shows them titled. */
const titled = (name: string) =>
  name
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/** Areas › Served › Add pincodes by district: a state, a district, every pincode not held, into the city. */
async function addFromDirectory(page: Page, plan: CityPlan): Promise<number> {
  const copy = areasCopy.directory;
  await page.getByRole("combobox", { name: copy.state }).selectOption(plan.state);
  const district = page.getByRole("checkbox", { name: new RegExp(`^${titled(plan.district)} · \\d+ pincodes`) });
  await district.check();
  await page.getByRole("button", { name: copy.show }).click();
  await page.getByRole("checkbox", { name: copy.all }).check();
  await page.getByRole("combobox", { name: copy.city }).selectOption(plan.city);
  const added = page.waitForResponse((answer) => answer.url().endsWith("/api/pincodes/from-directory"));
  await page.getByRole("button", { name: /^Add \d+ pincodes?$/ }).click();
  const answer = await added;
  check(answer.status() === 201, `adding from the directory answered ${String(answer.status())}`);
  const body = (await answer.json()) as { added: { pincode: string }[] };
  await expect(page.getByText(new RegExp(`^\\d+ added to ${plan.city}, not served yet\\.`))).toBeVisible();
  return body.added.length;
}

export async function openCities(
  sim: Sim,
  day: number,
  wave: string,
  staffed: (city: string) => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  const plans = OPENINGS[day] ?? [];
  const { desk, ops, steps, world } = sim;
  for (const plan of plans) {
    // The city is ours to serve: Mumbai and Bengaluru come unserved from the migrations.
    await steps.run(
      {
        wave,
        workflow: "City lifecycle",
        app: "ops",
        screen: "/settings/cities",
        action: `${plan.city}: served, active`,
        mode: "api",
      },
      async () => {
        const book = await ops.must<{
          cities: { name: string; state_code: string; state: string; zone: string | null }[];
        }>("GET", "/api/cities");
        const city = book.cities.find((each) => each.name === plan.city);
        check(city !== undefined, `no city ${plan.city}`);
        if (city === undefined) return;
        const { name, state_code, state, zone } = city;
        await ops.must("PATCH", `/api/cities/${encodeURIComponent(plan.city)}`, {
          name,
          state_code,
          state,
          zone,
          served: true,
          active: true,
        });
        await desk.go("/settings/cities");
        await expect(desk.page.getByRole("heading", { level: 1, name: opsCopy.cities.title })).toBeVisible();
        await expect(desk.page.getByRole("row").filter({ hasText: plan.city }).first()).toBeVisible();
      },
      { pages: [desk.page] },
    );

    const added = await steps.run(
      {
        wave,
        workflow: "Pincode expansion",
        app: "ops",
        screen: "/settings/areas",
        action: `${plan.city}: add ${plan.district} from India Post's directory`,
        mode: "ui",
      },
      async () => {
        await desk.go("/settings/areas");
        await expect(desk.page.getByRole("heading", { level: 1 })).toBeVisible();
        return addFromDirectory(desk.page, plan);
      },
      {
        pages: [desk.page],
        heal: async () => {
          const listed = await ops.must<{ pincodes: { pincode: string; area: string }[] }>(
            "GET",
            `/api/pincode-directory/pincodes?state=${encodeURIComponent(plan.state)}&district=${encodeURIComponent(plan.district)}`,
          );
          const answer = await ops.must<{ added: unknown[] }>("POST", "/api/pincodes/from-directory", {
            city: plan.city,
            pincodes: listed.pincodes.map(({ pincode, area }) => ({ pincode, area })),
          });
          return answer.added.length;
        },
      },
    );

    // Its technicians, through the roster's Add form, then their hours, a home pin and a phone signed in.
    for (const person of plan.technicians) {
      const technician = await addTechnician(sim, wave, plan.city, person);
      if (technician !== undefined) await setUpTechnician(sim, wave, technician);
    }
    await staffed(plan.city);

    // The first of its pincodes served from today; the rest scheduled to go live in a week, through Launches.
    const held = await ops.must<{ pincodes: { pincode: string; city: string; served: boolean; area: string }[] }>(
      "GET",
      "/api/service-area",
    );
    const mine = held.pincodes.filter((each) => each.city === plan.city && /^[1-8]/.test(each.pincode));
    const serveNow = mine.slice(0, plan.serve);
    const later = mine.slice(plan.serve, plan.serve + 6);
    await steps.run(
      {
        wave,
        workflow: "Pincode expansion",
        app: "ops",
        screen: "/settings/areas › Served",
        action: `${plan.city}: serve ${String(serveNow.length)} pincodes from today`,
        mode: "ui+api",
      },
      async () => {
        check(serveNow.length > 0, `no pincode of ${plan.city} to serve (added ${String(added ?? 0)})`);
        const [first, ...rest] = serveNow;
        if (first === undefined) return;
        // One through the table's own drawer, as ops do; the rest in one save, as the table's bulk save sends them.
        await desk.go("/settings/areas");
        const row = desk.page.getByRole("button", { name: areasCopy.served.editLabel(first.pincode) });
        if ((await row.count()) === 0) {
          await desk.page.getByRole("button", { name: new RegExp(`^${plan.city} · \\d+ of \\d+$`) }).click();
        }
        await desk.page.getByRole("button", { name: areasCopy.served.editLabel(first.pincode) }).click();
        const drawer = desk.page.getByRole("dialog");
        await drawer.getByLabel(areasCopy.served.columns[2]).check();
        await drawer.getByRole("button", { name: areasCopy.served.save }).click();
        // A save that marks a pincode live goes through the launch panel, which says who it messages.
        const send = desk.page.getByRole("button", { name: /^(Mark live|Send to \d+|Save and send to \d+)$/ });
        const asked = await send
          .first()
          .waitFor({ timeout: 3_000 })
          .then(
            () => true,
            () => false,
          );
        if (asked) await send.first().click();
        await ops.must("POST", "/api/service-area", {
          changes: rest.map((each) => ({ pincode: each.pincode, served: true, launch_on: null })),
        });
        const after = await ops.must<{ pincodes: { pincode: string; served: boolean }[] }>("GET", "/api/service-area");
        const served = after.pincodes.filter(
          (each) => serveNow.some((one) => one.pincode === each.pincode) && each.served,
        );
        check(
          served.length === serveNow.length,
          `${String(served.length)} of ${String(serveNow.length)} pincodes read served`,
        );
      },
      {
        pages: [desk.page],
        heal: async () => {
          await ops.must("POST", "/api/service-area", {
            changes: serveNow.map((each) => ({ pincode: each.pincode, served: true, launch_on: null })),
          });
        },
      },
    );
    world.cities.set(plan.city, { pincodes: serveNow.map((each) => each.pincode), opened: day });

    if (later.length > 0) {
      await steps.run(
        {
          wave,
          workflow: "Pincode expansion",
          app: "ops",
          screen: "/settings/areas › Launches",
          action: `${plan.city}: schedule ${String(later.length)} pincodes for ${dateOf(day + 7)}`,
          mode: "api",
        },
        async () => {
          const readiness = await ops.call(
            "GET",
            `/api/pincode-launches/readiness?city=${encodeURIComponent(plan.city)}`,
          );
          check(readiness.status === 200, `readiness answered ${String(readiness.status)}`);
          const launch = await ops.must<{ id: string; state: string }>("POST", "/api/pincode-launches", {
            city: plan.city,
            pincodes: later.map((each) => each.pincode),
            go_live_on: dateOf(day + 7),
          });
          check(launch.state === "scheduled", `the launch reads ${launch.state}`);
          world.notes.push(
            `launch ${launch.id} ${plan.city} ${later.map((each) => each.pincode).join(",")} on day ${String(day + 7)}`,
          );
        },
      );
    }
  }
}

async function addTechnician(
  sim: Sim,
  wave: string,
  city: string,
  person: { name: string; fits: boolean },
): Promise<Technician | undefined> {
  const { desk, ops, steps, world } = sim;
  const mobile = mobileFor("9");
  const copy = opsCopy.technicians;
  return steps.run(
    {
      wave,
      workflow: "Technician onboarding",
      app: "ops",
      screen: "/technicians › Add",
      action: `add ${person.name} in ${city}`,
      mode: "ui",
    },
    async () => {
      await desk.go("/technicians");
      await desk.page.getByRole("button", { name: copy.add.open }).click();
      const form = desk.page.getByRole("dialog", { name: copy.add.open });
      await form.getByRole("textbox", { name: copy.fields.name }).fill(person.name);
      await form.getByRole("textbox", { name: copy.fields.mobile }).fill(mobile);
      await form.getByRole("combobox", { name: copy.fields.city }).selectOption(city);
      if (person.fits) await form.getByRole("checkbox", { name: copy.fields.fitsTrained }).check();
      const sent = desk.page.waitForResponse(
        (answer) => answer.request().method() === "POST" && answer.url().endsWith("/api/technicians"),
      );
      await form.getByRole("button", { name: copy.add.save }).click();
      const answer = await sent;
      check(answer.status() === 201, `adding a technician answered ${String(answer.status())}`);
      const { id } = (await answer.json()) as { id: string };
      await expect(desk.page.getByRole("status")).toContainText(`${person.name} added`);
      const technician: Technician = {
        id,
        name: person.name,
        mobile,
        city,
        deviceId: `tl-${randomUUID().slice(0, 12)}`,
        fits: person.fits,
        active: true,
      };
      world.technicians.push(technician);
      return technician;
    },
    {
      pages: [desk.page],
      heal: async () => {
        const { id } = await ops.must<{ id: string }>("POST", "/api/technicians", {
          name: person.name,
          mobile,
          city,
          fits_trained: person.fits,
        });
        const technician: Technician = {
          id,
          name: person.name,
          mobile,
          city,
          deviceId: `tl-${randomUUID().slice(0, 12)}`,
          fits: person.fits,
          active: true,
        };
        world.technicians.push(technician);
        return technician;
      },
    },
  );
}

/** Monday to Saturday, nine to seven; Sunday off. */
const WEEK = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "09:00", ends: "19:00" }));

async function setUpTechnician(sim: Sim, wave: string, technician: Technician): Promise<void> {
  const { ops, steps } = sim;
  await steps.run(
    {
      wave,
      workflow: "Technician hours & home",
      app: "ops",
      screen: `/technicians/${technician.id}/hours`,
      action: `${technician.name}: hours and a home pin`,
      mode: "api",
    },
    async () => {
      await ops.must("POST", `/api/technicians/${technician.id}/hours`, { days: WEEK });
      const session = randomUUID();
      const found = await ops.must<{ suggestions: { place_id: string }[] }>(
        "POST",
        `/api/technicians/${technician.id}/home/suggestions`,
        {
          q: `${technician.city} sector 14`,
          session,
        },
      );
      const place = found.suggestions[0];
      check(place !== undefined, "the home search found no place");
      if (place === undefined) return;
      await ops.must("POST", `/api/technicians/${technician.id}/home`, {
        place_id: place.place_id,
        session_token: session,
      });
      await sim.desk.go(`/technicians/${technician.id}/hours`);
      await sees(sim.desk.page, opsCopy.technicians.hours.title);
    },
    { pages: [sim.desk.page] },
  );
  await steps.run(
    {
      wave,
      workflow: "Technician sign-in",
      app: "tech",
      screen: "/ (sign in)",
      action: `${technician.name} signs in on their phone`,
      mode: "api",
    },
    async () => {
      const wire = new Wire("tech", steps);
      check(await techSignIn(wire, technician.mobile, technician.deviceId), "the code did not sign them in");
      technician.wire = wire;
    },
  );
}

/** The directory lists two Army base offices, 9xxxxx; the routes that add them and the routes that serve them differ. */
export async function armyPincodeProbe(sim: Sim, wave: string): Promise<void> {
  await sim.steps.run(
    {
      wave,
      workflow: "Pincode expansion",
      app: "worker",
      screen: "POST /api/pincodes/from-directory → /api/service-area",
      action: "a directory pincode the service area cannot serve",
      mode: "api",
      allow: [400],
    },
    async () => {
      const added = await sim.ops.call<{ added: unknown[] }>("POST", "/api/pincodes/from-directory", {
        city: "Delhi",
        pincodes: [{ pincode: "900056" }],
      });
      if (added.status !== 201 || added.body.added.length === 0) return;
      const served = await sim.ops.call("POST", "/api/service-area", {
        changes: [{ pincode: "900056", served: true, launch_on: null }],
      });
      check(
        served.status === 200,
        `900056 was added to Delhi from the directory (201) but serving it is refused (${String(served.status)}): the directory takes ^[1-9]\\d{5}$, the service area ^[1-8]\\d{5}$`,
      );
    },
  );
}
