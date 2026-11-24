// Every action in the ops console is drawn as its icon, its words its name and its hover label
// (docs/decisions/0316-every-console-action-an-icon.md). A button that keeps its words is a record's own name or a
// piece of content: a client, a time, a quick reply's title. Each such file is counted here, so a new action without
// an icon fails, and so does one that takes an icon where a name stood.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = "apps/ops/src";
const BUTTON = /<(Button|RowButton|TextButton|DrawerButton)(?![A-Za-z])/g;

/** The buttons in each file that are a record's name or a piece of content, so keep their words. */
const KEEPS_WORDS: Readonly<Record<string, number>> = {
  // A record's name, or its number, that opens it.
  "activity/Entries.tsx": 1,
  "areas/Waiting.tsx": 1,
  "care/CareTeam.tsx": 1,
  "cities/CityList.tsx": 1,
  "deletion-requests/DeletionsScreen.tsx": 1,
  "discount-codes/DiscountCodes.tsx": 1,
  "grievances/GrievancesScreen.tsx": 1,
  "items/Consumables.tsx": 1,
  "number-changes/NumberChangesScreen.tsx": 1,
  "packages/HairSystems.tsx": 1,
  "packages/PackagesScreen.tsx": 1,
  "purchasing/Claims.tsx": 1,
  "purchasing/PurchasingScreen.tsx": 1,
  "quality/QualityScreen.tsx": 1,
  "referrals/Partners.tsx": 1,
  "staff/Staff.tsx": 1,
  "stock/PlacesPanel.tsx": 1,
  "suppliers/SupplierItems.tsx": 1,
  "suppliers/Suppliers.tsx": 1,
  "supply-plan/SupplyPlanScreen.tsx": 1,
  "technician-pay/PayRates.tsx": 1,
  "technician-pay/PayStatement.tsx": 1,
  "technician-pay/TechnicianPay.tsx": 1,
  "usage/UsageScreen.tsx": 1,
  "words/WordsScreen.tsx": 1,
  // The day the board shows, a visit's client or time, a day's routes.
  "dispatch/BoardControls.tsx": 1,
  "dispatch/DayBoard.tsx": 3,
  "dispatch/Grid.tsx": 1,
  // A quick reply's title, and a placeholder put into the reply.
  "care/QuickReplies.tsx": 2,
};

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** Each button's opening tag, up to the > that closes it outside any {expression}. */
function buttonTags(text: string): string[] {
  return [...text.matchAll(BUTTON)].map((match) => {
    let depth = 0;
    let end = match.index;
    for (; end < text.length; end += 1) {
      const ch = text[end];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    return text.slice(match.index, end + 1);
  });
}

function wordsOnly(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of filesUnder(ROOT)) {
    const count = buttonTags(readFileSync(file, "utf8")).filter((tag) => !/\bicon=/.test(tag)).length;
    if (count > 0) found[file.slice(ROOT.length + 1)] = count;
  }
  return found;
}

describe("the console's actions", () => {
  it("each name an icon, but for a record's name or a piece of content", () => {
    expect(wordsOnly()).toEqual(KEEPS_WORDS);
  });

  it("would catch a button without one", () => {
    const tags = buttonTags(`<Button variant="outline" onClick={() => { go(); }}>Go</Button><RowButton icon={x}>`);
    expect(tags.map((tag) => /\bicon=/.test(tag))).toEqual([false, true]);
  });
});
