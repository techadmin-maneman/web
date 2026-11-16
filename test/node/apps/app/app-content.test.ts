// The client app's own values, held to their sources: the tabs to the design's tab bar, and the business number and
// booking page to the public site's.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOOKING_URL, tabs, whatsapp } from "../../../../apps/app/src/content.ts";
import { GLYPHS } from "../../../../packages/brand/icons.ts";
import { whatsapp as siteWhatsapp } from "../../../../site/src/content/site.ts";
import { HOSTNAME } from "../../../../src/config/environments.ts";

describe("the client app’s content", () => {
  it("names the tabs as the design’s tab bar does, in its order", () => {
    const design = readFileSync("design/client-redesign/Client App.prototype.html", "utf8");
    const bar = /const t=(\[\[.*?\]\]);/.exec(design.slice(design.indexOf("const tabbar=")))?.[1] ?? "[]";
    const drawn = [...bar.matchAll(/\['(\w+)','([^']+)'/g)].map((match) => [
      `/${match[1]}`.replace("/home", "/"),
      match[2],
    ]);
    expect(drawn).toEqual(tabs.map((tab) => [tab.page, tab.label]));
  });

  it("draws A2's bubble as the design does beside its automatic reading", () => {
    const design = readFileSync("design/phase2/Client App.dc.html", "utf8");
    const line = design.indexOf("Read automatically where your phone allows");
    const drawn = /<path d="([^"]+)"><\/path><\/svg>\s*$/.exec(design.slice(line - 400, line));
    expect(drawn?.[1]).toBe(GLYPHS.bubble);
  });

  it("messages the public site’s business WhatsApp number", () => {
    expect(whatsapp.number).toBe(siteWhatsapp.number);
  });

  it("sends a number with no booking to the public site’s booking page, in each environment", () => {
    expect(BOOKING_URL.staging).toBe(`https://${HOSTNAME.staging}/book`);
    expect(BOOKING_URL.production).toBe(`https://${HOSTNAME.production}/book`);
  });
});
