// A client matched to stock, on their Pieces tab in the console (apps/ops/src/clients/StockMatch.tsx;
// docs/decisions/0173-matching-a-client-to-stock.md): the code made to their profile and where its pieces are, what
// the profile lacks, or that theirs is a custom order. Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockMatch } from "../../apps/ops/src/clients/StockMatch.tsx";
import { stockMatch as copy } from "../../apps/ops/src/content/stock-match.ts";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const NONE = { kind: "no_profile", missing: [], code: null, name: null, city: null, held: [], in_transit: 0 };

let page: HTMLDivElement;
let root: Root;
let answer: unknown;
let shown = 0;

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(answer)));
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.unstubAllGlobals();
});

async function show(match: unknown) {
  answer = match;
  act(() => {
    shown += 1;
    root.render(createElement(StockMatch, { clientId: `${CLIENT}-${String(shown)}` }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the client’s match to stock", () => {
  it("names the code made to the profile, where its pieces are, their city first, and what is on its way", async () => {
    await show({
      kind: "stocked",
      missing: [],
      code: "hs_essential_8x10_1b_g20_d100",
      name: "Mane Man Essential 8x10 1B, 20% grey, 100%",
      city: "Gurgaon",
      held: [
        { place_id: "kit-1", name: "Imran Qureshi", kind: "kit", city: "Gurgaon", pieces: 1 },
        { place_id: "central", name: "National warehouse", kind: "warehouse", city: null, pieces: 4 },
      ],
      in_transit: 2,
    });
    expect(page.textContent).toContain(copy.matched("Mane Man Essential 8x10 1B, 20% grey, 100%"));
    expect(page.textContent).toContain("1 piece · Imran Qureshi, Gurgaon");
    expect(page.textContent).toContain("4 pieces · National warehouse");
    expect(page.textContent).toContain(copy.inTransit(2));
  });

  it("says when none is held yet, what the profile lacks, that there is none, or that theirs is a custom order", async () => {
    await show({ ...NONE, kind: "stocked", code: "hs_1", name: "A hair system" });
    expect(page.textContent).toContain(copy.noneHeld);
    await show({ ...NONE, kind: "incomplete", missing: ["colour", "grey_percent", "density_percent"] });
    expect(page.textContent).toContain("The profile needs colour, grey and density to match stock.");
    await show({ ...NONE, kind: "incomplete", missing: ["density_percent"] });
    expect(page.textContent).toContain("The profile needs density to match stock.");
    await show(NONE);
    expect(page.textContent).toContain(copy.noProfile);
    await show({ ...NONE, kind: "custom" });
    expect(page.textContent).toContain(copy.custom);
  });
});
