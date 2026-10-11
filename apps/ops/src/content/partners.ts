// The Partners panel's words, on Referrals (Growth; docs/decisions/0123-partner-referral-channels.md). The panel
// imports them itself, so they stay out of the console's first load.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

export const partners = {
  title: "Partners",
  none: "No partners yet.",
  add: "Add partner",
  adding: "Adding",
  form: {
    name: "Partner",
    friendVisits: "Friend's free visits",
    validDays: "Visits last (days)",
    commission: "Commission per fit (Rs.)",
    save: "Save",
    saving: "Saving",
    cancel: "Cancel",
  },
  columns: {
    name: "Partner",
    link: "Link",
    friend: "Friend gets",
    commission: "Commission",
    opens: "Opens",
    referred: "Came",
    fitted: "Fitted",
    earned: "Earned",
    change: "Change",
  },
  /** "maneman.in/r/LSK7P2QX", as the partner's counter card prints it. */
  link: (host: string, code: string) => `${host}/r/${code}`,
  friendGets: (visits: number, days: number) =>
    visits === 0 ? "Nothing" : `${String(visits)} ${visits === 1 ? "visit" : "visits"} · ${String(days)} days`,
  paused: "Paused",
  edit: "Edit",
  editLabel: (name: string) => `Edit ${name}`,
  pause: "Pause",
  pauseLabel: (name: string) => `Pause ${name}`,
  resume: "Resume",
  resumeLabel: (name: string) => `Resume ${name}`,
  errors: {
    name: "Up to 60 letters or digits.",
    friend_visits: "Between 0 and 12.",
    valid_days: "Between 30 and 1,095 days.",
    commission: "A whole amount, within the most a fit may earn.",
    taken: "A partner has that name.",
    not_found: "Not found. Reload.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  },
};
