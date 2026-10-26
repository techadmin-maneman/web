// Which waves run on which sim day, in the order they run in it: the morning's console work first, then the day in
// the field, the evening's bookings, and the checks last, so they read the day whole. Each workflow runs at several
// points in time: day 1's opening, the middle of a month, month ends, after a price or rule change, and late, under
// six months of records.

import { acquire, joinWaitlist, settleHolds } from "./flows/clients.ts";
import {
  care,
  customOrder,
  doubleBooking,
  exportAndErase,
  grievanceAndRefund,
  holdExpiry,
  moveAndCancel,
  noShow,
  numberChange,
  proposedMove,
  referFriend,
} from "./flows/client-events.ts";
import {
  counts,
  discountCodes,
  leave,
  monthKey,
  partner,
  partnerMonth,
  permissions,
  payStatement,
  priceChange,
  pricesHeld,
  recall,
  setUpPay,
  staff,
} from "./flows/ops-cycles.ts";
import {
  deskClockDrift,
  launchWentLive,
  opsBooking,
  profileUpkeep,
  switchOffAndOn,
  waitlistTold,
} from "./flows/gaps.ts";
import { reconcile } from "./flows/reconcile.ts";
import { appBooking, siteBooking, techJobOnScreen } from "./flows/screens.ts";
import { setUpCatalogue } from "./flows/catalog.ts";
import { fieldDay, readChecklists } from "./flows/field.ts";
import { armyPincodeProbe, openCities, OPENINGS } from "./flows/geography.ts";
import { distribute, draftAndSend, receive, stockAtRisk } from "./flows/purchasing.ts";
import { eveningBookings } from "./flows/routine.ts";
import { CHECKPOINT_PAGES, EVERY_PAGE, sweep } from "./flows/sweep.ts";
import { at, isMonthEnd, monthOf, weekdayOf } from "./sim.ts";
import type { Sim } from "./world.ts";

export interface Wave {
  readonly name: string;
  readonly on: (day: number) => boolean;
  readonly run: (sim: Sim, day: number) => Promise<void>;
}

const OPENING_DAYS = Object.keys(OPENINGS).map(Number);
const HOLD_DAYS = [10, 55, 100, 145];
/** The pincode someone has waited in since the start, served the day its city opens. */
const WAITED = new Map([
  [45, { pincode: "201301", city: "Noida" }],
  [90, { pincode: "400050", city: "Mumbai" }],
  [135, { pincode: "560001", city: "Bengaluru" }],
]);
const NO_SHOW_DAYS = [12, 40, 68, 96, 124, 152];
/** The day each month's order goes out: the second of the month's first week. */
const ORDER_DAYS = [2, 32, 62, 92, 122, 152];
const orderMonth = (day: number) => ORDER_DAYS.findIndex((each) => day >= each && day < each + 30) + 1;

const WAVES: readonly Wave[] = [
  {
    name: "geography",
    on: (day) => OPENING_DAYS.includes(day),
    run: async (sim, day) => {
      const wave = `geography#${String(OPENING_DAYS.indexOf(day) + 1)}`;
      const waited = WAITED.get(day);
      // The waiting pincode is served once the city has its technicians, before the city's own pincodes are.
      await openCities(sim, day, wave, async (city) => {
        if (waited?.city === city) await waitlistTold(sim, wave, waited.pincode, waited.city);
      });
      if (day === 1) await armyPincodeProbe(sim, wave);
    },
  },
  {
    name: "catalogue",
    on: (day) => day === 1,
    run: async (sim) => {
      await setUpCatalogue(sim, "catalogue#1");
      await readChecklists(sim.ops);
      await setUpPay(sim, "pay#1");
      await staff(sim, "staff#1", 1);
      await discountCodes(sim, "discounts#1");
      await partner(sim, "partners#1");
    },
  },
  {
    name: "price and rule changes",
    on: (day) => [45, 90, 135].includes(day),
    run: async (sim, day) => {
      await priceChange(sim, `pricing#${String(day / 45)}`, day / 45);
      if (day === 45) await staff(sim, "staff#2", 2);
    },
  },
  {
    name: "clock drift",
    on: (day) => [2, 92, 178].includes(day),
    run: (sim, day) => deskClockDrift(sim, `drift#${String([2, 92, 178].indexOf(day) + 1)}`),
  },
  {
    name: "launches live",
    on: (day) => [9, 53, 98, 143].includes(day),
    run: (sim, day) => launchWentLive(sim, `launch#${String([9, 53, 98, 143].indexOf(day) + 1)}`),
  },
  {
    name: "ops booking",
    on: (day) => day % 14 === 9,
    run: (sim, day) => opsBooking(sim, `ops-booking#${String(Math.ceil(day / 14))}`),
  },
  {
    name: "technician switch",
    on: (day) => day === 120,
    run: (sim) => switchOffAndOn(sim, "switch#1"),
  },
  {
    name: "profile upkeep",
    on: (day) => [30, 90, 150].includes(day),
    run: (sim, day) => profileUpkeep(sim, `profile#${String(day / 30)}`),
  },
  {
    name: "permissions",
    on: (day) => [3, 47, 121].includes(day),
    run: (sim, day) => permissions(sim, `access#${String([3, 47, 121].indexOf(day) + 1)}`),
  },
  {
    name: "prices held",
    on: (day) => [52, 97, 142].includes(day),
    run: (sim, day) => pricesHeld(sim, `pricing#${String(Math.round((day - 7) / 45))}`),
  },
  {
    name: "purchasing",
    on: (day) => ORDER_DAYS.some((each) => [each, each + 6, each + 9].includes(day)),
    run: async (sim, day) => {
      const month = orderMonth(day);
      const wave = `purchasing#${String(month)}`;
      if (ORDER_DAYS.includes(day)) await draftAndSend(sim, wave, month);
      else {
        await receive(sim, wave, ORDER_DAYS.includes(day - 6) ? 0.6 : 1);
        await distribute(sim, wave);
      }
    },
  },
  {
    name: "acquisition",
    on: (day) => weekdayOf(day) === 1 || weekdayOf(day) === 4,
    run: async (sim, day) => {
      const wave = `acquisition#${String(Math.ceil(day / 7))}`;
      await acquire(sim, wave, weekdayOf(day) === 1 ? 3 : 1, Math.ceil(day / 7));
      if (weekdayOf(day) !== 1) return;
      // Someone waits in the next city to open, so its launch has people to tell.
      if (day < 135) await joinWaitlist(sim, wave, day < 45 ? "201301" : day < 90 ? "400050" : "560001");
      const opened = [...sim.world.cities.entries()];
      const [city, held] = opened[Math.ceil(day / 7) % opened.length] ?? [];
      if (city !== undefined && held !== undefined && Math.ceil(day / 7) % 4 === 1) {
        await siteBooking(sim, wave, held.pincodes[1] ?? held.pincodes[0] ?? "", city);
      }
    },
  },
  {
    name: "leave",
    on: (day) => [15, 46, 76, 106, 136, 166].includes(day),
    run: (sim, day) => leave(sim, `leave#${String(Math.ceil(day / 30))}`),
  },
  {
    name: "cycle counts",
    on: (day) => [25, 85, 145, 175].includes(day),
    run: (sim, day) => counts(sim, `counts#${String(Math.ceil(day / 30))}`),
  },
  {
    name: "recalls",
    on: (day) => [55, 115, 172].includes(day),
    run: (sim, day) => recall(sim, `quality#${String(Math.ceil(day / 30))}`),
  },
  {
    name: "hold expiry",
    on: (day) => HOLD_DAYS.includes(day),
    run: (sim, day) => holdExpiry(sim, `holds#${String(HOLD_DAYS.indexOf(day) + 1)}`, HOLD_DAYS.indexOf(day) * 2),
  },
  {
    name: "no-shows",
    on: (day) => NO_SHOW_DAYS.includes(day),
    run: (sim, day) =>
      noShow(sim, `noshow#${String(NO_SHOW_DAYS.indexOf(day) + 1)}`, day % 2 === 0 ? "upheld" : "refunded"),
  },
  {
    name: "stock at risk",
    on: (day) => day > 7,
    run: (sim, day) => stockAtRisk(sim, `stock-risk#${String(day)}`),
  },
  {
    name: "field",
    on: (day) => weekdayOf(day) !== 0,
    run: (sim, day) => {
      const offline = [15, 45, 75, 105, 135, 165].includes(day);
      const wave = offline ? `offline#${String([15, 45, 75, 105, 135, 165].indexOf(day) + 1)}` : `field#${String(day)}`;
      return fieldDay(sim, wave, {
        onScreen:
          day % 5 === 0 || offline
            ? (technician, job, cut) => techJobOnScreen(sim, wave, technician, job, cut)
            : undefined,
        offline,
      });
    },
  },
  {
    name: "client events",
    on: (day) => day % 14 === 7,
    run: async (sim, day) => {
      const wave = `changes#${String((day + 7) / 14)}`;
      await moveAndCancel(sim, wave);
      await proposedMove(sim, wave);
      await doubleBooking(sim, wave);
      if (((day + 7) / 14) % 2 === 1) await care(sim, wave);
      else await grievanceAndRefund(sim, wave);
    },
  },
  {
    name: "custom orders",
    on: (day) => [20, 50, 80, 110, 140, 170].includes(day),
    run: (sim, day) => customOrder(sim, `custom#${String(Math.round(day / 30 + 0.5))}`),
  },
  {
    name: "privacy and referrals",
    on: (day) => [50, 110, 170].includes(day),
    run: async (sim, day) => {
      const wave = `privacy#${String((day + 10) / 60)}`;
      await numberChange(sim, wave);
      await exportAndErase(sim, wave);
      await referFriend(sim, wave);
    },
  },
  {
    name: "evening bookings",
    on: () => true,
    run: async (sim, day) => {
      await sim.clock.advanceTo(Math.max(sim.clock.now, at(day, "19:00")));
      await eveningBookings(sim, `bookings#${String(day)}`);
      await settleHolds(sim, `bookings#${String(day)}`);
      if (day % 14 === 3) {
        const due = sim.world.clients.find(
          (client) =>
            client.fitted &&
            !client.erased &&
            client.wire !== undefined &&
            !client.visits.some((id) => sim.world.visits.get(id)?.status === "booked"),
        );
        if (due !== undefined) await appBooking(sim, `app-booking#${String(Math.ceil(day / 14))}`, due);
      }
    },
  },
  {
    name: "opening read",
    on: (day) => day === 1,
    run: (sim) => sweep(sim, "opening#1", EVERY_PAGE),
  },
  {
    name: "checkpoint",
    on: (day) => day % 14 === 0 && !isMonthEnd(day),
    run: (sim, day) => sweep(sim, `checkpoint#${String(day / 14)}`, CHECKPOINT_PAGES),
  },
  {
    name: "month-end",
    on: (day) => isMonthEnd(day),
    run: async (sim, day) => {
      const wave = `month-end#${String(monthOf(day))}`;
      await sim.clock.advanceTo(Math.max(sim.clock.now, at(day, "22:00")));
      await payStatement(sim, wave, monthKey(day));
      await reconcile(sim, wave, monthKey(day));
      if ([2, 4, 6].includes(monthOf(day))) await partnerMonth(sim, wave, monthKey(day));
      await sweep(sim, wave, EVERY_PAGE);
    },
  },
];

export const wavesOn = (day: number): readonly Wave[] => WAVES.filter((wave) => wave.on(day));
