// The site gives no prices (docs/decisions/0204-the-sites-price-pipeline-removed.md): no sentence holds one, and the
// production gate stops a price typed into its copy.

import { describe, expect, it } from "vitest";
import { referral } from "../../../site/src/content/referral.ts";
import * as site from "../../../site/src/content/site.ts";
import { readJsonc } from "../../../scripts/lib/jsonc.ts";
import { publishProblems } from "../../../site/src/lib/publish-gate.ts";

describe("the site’s prices", () => {
  it("are given nowhere: no sentence holds a hole for one", () => {
    for (const text of [JSON.stringify(site), JSON.stringify(referral)]) {
      expect(text.match(/\{(?:firstFit|service|replacement|firstYear|firstFitRange)\}/g)).toBeNull();
    }
  });

  // The home page and /areas name the cities ops serve, so they go through the Worker in every environment.
  it("sends / and /areas through the site Worker, in every environment", () => {
    type Assets = { assets: { run_worker_first: string[] } };
    const config = readJsonc("site/wrangler.jsonc") as Assets & { env: Record<string, Assets> };
    for (const assets of [config, ...Object.values(config.env)].map((each) => each.assets)) {
      expect(assets.run_worker_first).toEqual(expect.arrayContaining(["/", "/areas"]));
    }
  });
});

describe("the publish gate, on prices", () => {
  // The try-on's notices await counsel (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), which the gate also
  // refuses (test/node/site/site-content.test.ts); here every notice is counted approved, so the prices are read alone.
  const approved = Object.fromEntries(
    Object.entries(site.notices).map(([name, notice]) => [name, { ...notice, approved: true }]),
  );
  const legalApproved = { privacy: { approved: true }, terms: { approved: true } };

  it("stops a price typed into the landing", () => {
    const landing = { ...referral, howItWorks: { ...referral.howItWorks, title: "From Rs. 25,000" } };

    expect(publishProblems(undefined, approved, [site, landing], legalApproved)).toEqual([
      'a price is typed by hand, "From Rs. 25,000": the site gives no price of ours (docs/decisions/0204-the-sites-price-pipeline-removed.md)',
    ]);
  });

  it("stops a price typed into the site, with the sign the site wrote before as well", () => {
    for (const typed of ["Rs. 43,000", "₹43,000"]) {
      const home = { ...site, guarantee: { ...site.guarantee, text: `A standard base in the first year: ${typed}.` } };
      expect(publishProblems(undefined, approved, [home, referral], legalApproved), typed).toHaveLength(1);
    }
  });

  it("lets through what a transplant and medication cost, which are not our prices", () => {
    expect(publishProblems(undefined, approved, [site, referral], legalApproved)).toEqual([]);
  });
});
