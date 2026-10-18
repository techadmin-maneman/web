// The Partners panel's words, on Referrals (Growth; docs/decisions/0123-partner-referral-channels.md). The panel
// imports them itself, so they stay out of the console's first load.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const partners = {
  /** The commission refused, with the most a fit may earn. */
  commissionUpTo: (most: string) => `Enter whole rupees, up to ${most} a fit.`,
  title: "Partners",
  none: "No partners yet.",
  add: "Add partner",
  columns: {
    name: "Partner",
    link: "Link",
    friend: "Friend gets",
    commission: "Commission",
    opens: "Opens",
    referred: "Booked",
    fitted: "Fitted",
    earned: "Earned",
    owed: "Owed",
  },
  /** A row's name, read as what pressing it does. */
  open: (name: string) => `Open ${name}`,
  /** Its record's values, a line each. */
  rows: {
    name: "Partner",
    friendVisits: "Free service visits for the friend",
    validDays: "Days to use them",
    days: (days: number) => `${String(days)} days`,
    daysUnit: "days",
    commission: "Commission per fit",
    discountCode: "Discount code",
    link: "Link",
    status: "Status",
    active: "Active",
    none: "None",
  },
  /** "maneman.in/r/LSK7P2QX", as the partner's counter card prints it. */
  link: (host: string, code: string) => `${host}/r/${code}`,
  friendGets: (visits: number, days: number) =>
    visits === 0 ? "Nothing" : `${String(visits)} ${visits === 1 ? "visit" : "visits"} · ${String(days)} days`,
  paused: "Paused",
  qr: "QR code",
  qrLabel: (name: string) => `Download the QR code for ${name}`,
  /** The file the QR code saves as: "maneman-LSK7P2QX.svg". */
  qrName: (code: string) => `maneman-${code}.svg`,
  pausing: {
    open: "Pause",
    label: (name: string) => `Pause ${name}`,
    warning: (name: string) => `Pause ${name}? Their link stops working until resumed.`,
    confirm: "Pause",
    sending: "Pausing…",
    cancel: "Cancel",
  },
  resume: "Resume",
  resumeLabel: (name: string) => `Resume ${name}`,
  form: {
    addTitle: "New partner",
    name: "Partner",
    friendVisits: "Free service visits for the friend",
    validDays: "Days to use them",
    commission: "Commission per fit, Rs.",
    discountCode: "Discount code, if any",
    add: "Add",
    cancel: "Cancel",
  },
  added: "Partner added.",
  errors: {
    name: "Up to 60 letters or digits.",
    friend_visits: "Between 0 and 12.",
    valid_days: "Between 30 and 1,095 days.",
    commission: "Enter whole rupees.",
    discount_code: "One of Finance’s codes, switched on, that covers a first fit.",
    taken: "A partner has that name.",
    not_found: changed("Not found."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
