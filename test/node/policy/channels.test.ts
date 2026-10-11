// The channel rule: a friend's invite or a partner's code first, then the click ID, the campaign tags and where the
// visitor came from; and a campaign's city by the first word of its name.

import { describe, expect, it } from "vitest";
import { campaignCity, channelOf, type LeadTouch } from "../../../src/policy/channels.ts";

const NONE: LeadTouch = {
  utmSource: null,
  utmMedium: null,
  gclid: null,
  fbclid: null,
  referrer: null,
  referredBefore: false,
  partnerBefore: false,
  foundUs: null,
};

describe("a lead's channel", () => {
  it("is a friend's referral, or a partner's, before anything the visit carried", () => {
    expect(channelOf({ ...NONE, gclid: "abc", referredBefore: true })).toBe("Referral");
    expect(channelOf({ ...NONE, gclid: "abc", partnerBefore: true })).toBe("Offline and partners");
  });

  it("is Google Ads on a Google click ID or a paid Google tag, and Meta Ads on a paid Meta tag", () => {
    expect(channelOf({ ...NONE, gclid: "abc" })).toBe("Google Ads");
    expect(channelOf({ ...NONE, utmSource: "Google", utmMedium: "CPC" })).toBe("Google Ads");
    expect(channelOf({ ...NONE, utmSource: "instagram", utmMedium: "paid_social", fbclid: "x" })).toBe("Meta Ads");
  });

  it("is organic where the visitor came from a search engine or a social site unpaid", () => {
    expect(channelOf({ ...NONE, referrer: "https://www.google.co.in/" })).toBe("Organic search");
    expect(channelOf({ ...NONE, utmSource: "bing" })).toBe("Organic search");
    expect(channelOf({ ...NONE, fbclid: "x" })).toBe("Organic social");
    expect(channelOf({ ...NONE, referrer: "https://l.instagram.com/?u=x" })).toBe("Organic social");
  });

  it("is Direct with nothing to go on, or a referrer that is neither", () => {
    expect(channelOf(NONE)).toBe("Direct");
    expect(channelOf({ ...NONE, referrer: "https://example.com/hair" })).toBe("Direct");
    expect(channelOf({ ...NONE, referrer: "not a link" })).toBe("Direct");
  });
});

describe("a campaign's city", () => {
  const cities = ["Gurgaon", "New Delhi", "Bengaluru"];

  it("is the city its name starts with, however it is written", () => {
    expect(campaignCity("gurgaon-search-hair-systems", cities)).toBe("Gurgaon");
    expect(campaignCity("New Delhi | Meta lookalike", cities)).toBe("New Delhi");
  });

  it("is none for a national campaign, or a name that starts with no city", () => {
    expect(campaignCity("national-brand-search", cities)).toBeNull();
    expect(campaignCity("gurgaonish-test", cities)).toBeNull();
  });
});
