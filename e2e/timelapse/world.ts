// What the timelapse has made so far, so later days can use it and the month-end checks can sum it: the cities and
// pincodes opened, the technicians and clients, every visit booked and what it was sold for, every payment, refund
// and pay statement, and the stock bought and used. Every name and number is made up.

import type { Browser } from "@playwright/test";
import type { Phone, Wire } from "./actors.ts";
import type { SimClock } from "./sim.ts";
import type { Steps } from "./steps.ts";

export interface Technician {
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  readonly city: string;
  readonly deviceId: string;
  readonly fits: boolean;
  wire?: Wire;
  phone?: Phone;
  active: boolean;
  /** Whether the run has put them on a pay grade. */
  graded?: boolean;
  /** How often they have signed in, the first included: a session runs out. */
  signIns?: number;
}

export interface Visit {
  readonly id: string;
  readonly type: "consultation" | "first_fit" | "service" | "replacement";
  readonly client: string;
  readonly startsAt: string;
  /** What the hold or the booking said it costs, in paise, GST included. */
  readonly price: number;
  readonly bookedOnDay: number;
  technician?: string;
  /** The sim day it closed, done, partly or as a no-show. */
  closedOnDay?: number;
  status: "booked" | "done" | "partial" | "no_show" | "cancelled" | "moved";
}

export interface Client {
  readonly name: string;
  mobile: string;
  readonly city: string;
  readonly pincode: string;
  readonly cohort: number;
  wire?: Wire;
  id?: string;
  fitted: boolean;
  erased: boolean;
  visits: string[];
  /** Whether their consultation went ahead to a fit; undefined until it closed. */
  goingAhead?: boolean;
  /** The piece they wear, by its label. */
  piece?: string;
  /** The sim day their last visit closed. */
  lastVisitDay?: number;
  /** The sim day they were fitted, and whether their piece has been replaced since. */
  fittedOn?: number;
  replaced?: boolean;
  /** The day the app was last asked for their fit, so a day with nothing open does not ask twice. */
  fitAsked?: number;
  customOrder?: boolean;
  /** Whether the app was asked for a fit once theirs was left partly done. */
  refitAskedInApp?: boolean;
  numberChanged?: boolean;
  referred?: boolean;
}

export interface Ledger {
  /** Paise taken, by Razorpay's webhook. */
  paid: number;
  refunded: number;
  payments: number;
  /** The same, by India's month of the sim day it was paid on ("2026-11"). */
  readonly byMonth: Map<string, { paid: number; payments: number }>;
}

export interface World {
  readonly cities: Map<string, { pincodes: string[]; opened: number }>;
  readonly technicians: Technician[];
  readonly clients: Client[];
  readonly visits: Map<string, Visit>;
  readonly ledger: Ledger;
  readonly notes: string[];
  /** Codes, suppliers, consumables and the like made through the console, by kind. */
  readonly made: Map<string, string[]>;
  /** The last price change: the day it applies from and the service visit's price then, the book's and Gurgaon's. */
  priceFrom?: { day: number; service: number; gurgaon: number };
  /** Days ops closed, and where. */
  readonly closedDays: { date: string; city: string }[];
  /** The partner's referral code. */
  partnerCode?: string;
}

export const newWorld = (): World => ({
  cities: new Map(),
  technicians: [],
  clients: [],
  visits: new Map(),
  ledger: { paid: 0, refunded: 0, payments: 0, byMonth: new Map() },
  notes: [],
  made: new Map(),
  closedDays: [],
});

export function remember(world: World, kind: string, value: string): void {
  world.made.set(kind, [...(world.made.get(kind) ?? []), value]);
}

/** Everything a workflow needs. */
export interface Sim {
  readonly browser: Browser;
  readonly clock: SimClock;
  readonly steps: Steps;
  readonly world: World;
  /** The console in a browser, for the screens. */
  readonly desk: Phone;
  /** The console's API as its pages call it, for setup the screens are read after. */
  readonly ops: Wire;
  /** The public site's API. */
  readonly site: Wire;
}

let serial = 0;
/** Where this run's numbers start, so two runs never share one. */
const SEED = Math.floor(Math.random() * 400_000_000);
/** A made-up mobile, ten digits, no other person in the run has. */
export function mobileFor(prefix: "7" | "8" | "9"): string {
  serial += 1;
  return `${prefix}${String(SEED + serial * 7_919)
    .padStart(9, "0")
    .slice(-9)}`;
}

/** A payment the run made through Razorpay's webhook, kept for the month-end books. */
export function recordPaid(world: World, month: string, amount: number): void {
  world.ledger.paid += amount;
  world.ledger.payments += 1;
  const held = world.ledger.byMonth.get(month) ?? { paid: 0, payments: 0 };
  world.ledger.byMonth.set(month, { paid: held.paid + amount, payments: held.payments + 1 });
}
