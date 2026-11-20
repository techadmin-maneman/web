// An ad account's daily spend report, read in the browser (docs/decisions/0288-attribution-and-conversions.md):
// Google Ads' Day, Campaign and Cost, or Meta's Day (or Reporting starts), Campaign name and Amount spent (INR), its
// title lines and totals passed over. A day is read only as written unmistakably, 2026-11-20 or Nov 20, 2026, never
// 20/11/2026, whose month a spreadsheet may have swapped.

export interface SpendRow {
  readonly day: string;
  readonly campaign: string;
  /** Paise. */
  readonly amount: number;
}

export type SpendRead =
  | { readonly ok: true; readonly rows: readonly SpendRow[] }
  | { readonly ok: false; readonly reason: "header" | "empty" }
  | { readonly ok: false; readonly reason: "day"; readonly line: number };

/** A row of a CSV: commas between fields, a field in double quotes may hold commas and doubled quotes. */
function fields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      out.push(field.trim());
      field = "";
    } else field += char ?? "";
  }
  out.push(field.trim());
  return out;
}

const DAY_HEADS = ["day", "date", "reporting starts"];
const CAMPAIGN_HEADS = ["campaign", "campaign name"];
const COST_HEADS = ["cost", "amount spent (inr)", "amount spent"];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A day as the report writes it, as YYYY-MM-DD; null for one that could be read two ways, or not at all. */
function dayOf(written: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(written)) return written;
  const spelt = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(written);
  if (spelt === null) return null;
  const month = MONTHS.indexOf((spelt[1] ?? "").toLowerCase());
  if (month < 0) return null;
  return `${spelt[3] ?? ""}-${String(month + 1).padStart(2, "0")}-${(spelt[2] ?? "").padStart(2, "0")}`;
}

/** Rupees as the report writes them, "1,234.56" or "₹1,234.56", in paise; null for no figure. */
function paiseOf(written: string): number | null {
  const figure = written.replace(/[₹,\s]|INR|Rs\.?/g, "");
  if (!/^\d+(\.\d+)?$/.test(figure)) return null;
  return Math.round(Number(figure) * 100);
}

/** A line's end, as Windows or anything else writes it. */
const LINE_BREAK = new RegExp("\\r?\\n");

const columnOf = (head: readonly string[], names: readonly string[]) =>
  head.findIndex((cell) => names.includes(cell.toLowerCase()));

/** The report's rows with spend, by day and campaign. */
export function readSpendCsv(text: string): SpendRead {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(LINE_BREAK);
  const headAt = lines.findIndex((line) => {
    const head = fields(line);
    return [DAY_HEADS, CAMPAIGN_HEADS, COST_HEADS].every((names) => columnOf(head, names) >= 0);
  });
  if (headAt < 0) return { ok: false, reason: "header" };
  const head = fields(lines[headAt] ?? "");
  const [day, campaign, cost] = [DAY_HEADS, CAMPAIGN_HEADS, COST_HEADS].map((names) => columnOf(head, names));
  const rows: SpendRow[] = [];
  for (const [index, line] of lines.entries()) {
    if (index <= headAt || line.trim() === "") continue;
    const cells = fields(line);
    const name = cells[campaign ?? -1] ?? "";
    const amount = paiseOf(cells[cost ?? -1] ?? "");
    // Google's totals, at the foot, name no campaign or call themselves one.
    if (name === "" || name.toLowerCase().startsWith("total") || amount === null || amount === 0) continue;
    const spent = dayOf(cells[day ?? -1] ?? "");
    if (spent === null) return { ok: false, reason: "day", line: index + 1 };
    rows.push({ day: spent, campaign: name.slice(0, 120), amount });
  }
  return rows.length === 0 ? { ok: false, reason: "empty" } : { ok: true, rows };
}
