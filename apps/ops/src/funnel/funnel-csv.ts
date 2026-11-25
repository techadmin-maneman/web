// The Funnel page's period as a CSV (docs/decisions/0324-the-weekly-dashboard.md): a row a channel and one for the
// total, the money and the steps from lead to fitted together, amounts in whole rupees before GST.

import { channelNamed } from "@rules/policy/channels.ts";
import { funnel } from "../content/funnel.ts";
import type { Acquisition } from "./funnel-api.ts";
import { noShowShare, tierWords } from "./ToFitted.tsx";

type Row = Acquisition["totals"];

const steps = funnel.toFitted;

/** Paise as whole rupees, a plain number a spreadsheet adds up. */
const rupeesOf = (paise: number): string => String(Math.round(paise / 100));

/** Paise over a count, as whole rupees; nothing where the count is none. */
const each = (paise: number, count: number): string => (count === 0 ? "" : rupeesOf(paise / count));

function cells(name: string, row: Row): string[] {
  const { steps: step } = row;
  return [
    name,
    rupeesOf(row.spend),
    String(row.leads),
    String(row.consults_booked),
    String(row.consults_done),
    String(step.fitted),
    each(row.spend, row.leads),
    each(row.spend, row.consults_done),
    steps.share(step.fitted, row.consults_done),
    String(step.leads_fitted),
    each(row.spend, step.leads_fitted),
    steps.counts(step.tiers.map((one) => ({ name: tierWords(one.tier), clients: one.clients }))),
    step.first_reply_minutes === null ? "" : String(step.first_reply_minutes),
    String(step.no_shows),
    noShowShare(row),
    steps.counts(step.lost.map((one) => ({ name: one.reason, clients: one.clients }))),
    String(row.first_fits),
    rupeesOf(row.first_fit_revenue),
  ];
}

/** The header, a row a channel, and the total. */
export const funnelCsvRows = (figures: Acquisition): string[][] => [
  [...funnel.csv.columns],
  ...figures.rows.map((row) => cells(channelNamed(row.channel), row)),
  cells(funnel.channels.total, figures.totals),
];
