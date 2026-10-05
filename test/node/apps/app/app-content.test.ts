// The client app's own values, held to their sources: the tab glyphs to the
// design's tab bar, and the business number and booking page to the public site's.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOOKING_URL, tabs, whatsapp } from "../../../../apps/app/src/content.ts";
import { BUBBLE, TAB_ICONS } from "../../../../apps/app/src/icons.ts";
import { whatsapp as siteWhatsapp } from "../../../../site/src/content/site.ts";
import { HOSTNAME } from "../../../../src/config/environments.ts";

describe("the client app's content", () => {
  it("draws the tab bar's glyphs as the design's tabs() does, in its order", () => {
    const design = readFileSync("design/phase2/Client App.dc.html", "utf8");
    const items = design.slice(design.indexOf("tabs(active) {"), design.indexOf("renderVals() {"));
    const drawn = [...items.matchAll(/\{ label: '([^']+)', d: '([^']+)' \}/g)].map((match) => [match[1], match[2]]);
    expect(drawn).toEqual(tabs.map((tab) => [tab.label, TAB_ICONS[tab.icon]]));
  });

  it("draws A2's bubble as the design does beside its automatic reading", () => {
    const design = readFileSync("design/phase2/Client App.dc.html", "utf8");
    const line = design.indexOf("Read automatically where your phone allows");
    const drawn = /<path d="([^"]+)"><\/path><\/svg>\s*$/.exec(design.slice(line - 400, line));
    expect(drawn?.[1]).toBe(BUBBLE);
  });

  it("messages the public site's business WhatsApp number", () => {
    expect(whatsapp.number).toBe(siteWhatsapp.number);
  });

  it("sends a number with no booking to the public site's booking page, in each environment", () => {
    expect(BOOKING_URL.staging).toBe(`https://${HOSTNAME.staging}/book`);
    expect(BOOKING_URL.production).toBe(`https://${HOSTNAME.production}/book`);
  });
});
