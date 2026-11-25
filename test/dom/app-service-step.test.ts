// The booking sheet's hair systems (apps/app/src/booking/steps/ServiceStep.tsx): the one the consultation recommended
// is marked beside its name, with who recommended it, and no other is.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OfferedService } from "../../apps/app/src/api.ts";
import { ServiceStep, type Recommended } from "../../apps/app/src/booking/steps/ServiceStep.tsx";
import { includingGst } from "../../apps/app/src/content.ts";

const price = { amount: 2_950_000, amount_ex_gst: 2_500_000, gst_percent: 18 };
const SERVICES: OfferedService[] = [
  { type: "first_fit", tier: "essential", name: "Essential", description: null, minutes: 180, price },
  { type: "first_fit", tier: "premium", name: "Premium", description: null, minutes: 180, price },
];

const rows = (recommended?: Recommended) => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    createElement(ServiceStep, {
      step: { at: 1, of: 2 },
      onClose: () => undefined,
      services: SERVICES,
      chosen: null,
      recommended,
      onChoose: () => undefined,
      onNext: () => undefined,
    }),
  );
  return [...page.querySelectorAll("label")].map((label) => label.textContent);
};

describe("the hair systems a first fit is booked as", () => {
  it("marks the one the consultation recommended, with who recommended it", () => {
    const [essential, premium] = rows({ tier: "premium", by: "Imran" });
    expect(essential).not.toContain("Recommended");
    expect(premium).toContain("Recommended by Imran");
  });

  it("marks it without a name where the technician is not known, and marks none without a recommendation", () => {
    expect(rows({ tier: "essential", by: null })[0]).toContain("Recommended");
    expect(rows().join(" ")).not.toContain("Recommended");
  });

  it("says each price includes GST, with the GST split beneath it", () => {
    for (const row of rows()) {
      expect(row).toContain(includingGst);
      expect(row).toContain("Rs. 25,000 + Rs. 4,500 GST");
    }
  });
});
