// The channel rule (ADR 0288): a code of ours first, then a paid click, the campaign tags, the page before, a call's
// pick and how the touch reached us; a client's channel is their first touch's unless a code came before booking; and a
// campaign's city by the first word of its name.

import { describe, expect, it } from "vitest";
import {
  campaignCity,
  carriesCampaign,
  clientChannel,
  touchChannel,
  type Touch,
} from "../../../src/policy/channels.ts";

const NONE: Touch = {
  utmSource: null,
  utmMedium: null,
  gclid: null,
  gbraid: null,
  wbraid: null,
  fbclid: null,
  ctwaClid: null,
  referrer: null,
  code: null,
  declared: null,
  via: "site",
};

describe("a touch's channel", () => {
  it("is the code's first: a friend's invite, a partner's code, a society's code, over a paid click", () => {
    expect(touchChannel({ ...NONE, gclid: "abc", code: "friend" })).toBe("referral");
    expect(touchChannel({ ...NONE, gclid: "abc", code: "partner" })).toBe("partner");
    expect(touchChannel({ ...NONE, gclid: "abc", utmSource: "meta", utmMedium: "paid_social", code: "society" })).toBe(
      "society",
    );
  });

  it("is Google Ads on any of Google's click IDs, over the campaign tags", () => {
    expect(touchChannel({ ...NONE, gclid: "abc" })).toBe("google_ads");
    expect(touchChannel({ ...NONE, gbraid: "abc" })).toBe("google_ads");
    expect(touchChannel({ ...NONE, wbraid: "abc" })).toBe("google_ads");
    expect(touchChannel({ ...NONE, gclid: "abc", utmSource: "meta", utmMedium: "paid_social" })).toBe("google_ads");
  });

  it("is Meta Ads on a click-to-WhatsApp ad, or Meta's click ID with a paid tag, but not its click ID alone", () => {
    expect(touchChannel({ ...NONE, ctwaClid: "x", via: "whatsapp" })).toBe("meta_ads");
    expect(touchChannel({ ...NONE, utmSource: "instagram", utmMedium: "paid_social", fbclid: "x" })).toBe("meta_ads");
    expect(touchChannel({ ...NONE, fbclid: "x" })).toBe("organic_social");
  });

  it("reads the tags whatever their case: a paid Google tag, a society's offline tag, an organic source", () => {
    expect(touchChannel({ ...NONE, utmSource: "Google", utmMedium: "CPC" })).toBe("google_ads");
    expect(touchChannel({ ...NONE, utmSource: "society", utmMedium: "offline" })).toBe("society");
    expect(touchChannel({ ...NONE, utmSource: "salon", utmMedium: "offline" })).toBe("partner");
    expect(touchChannel({ ...NONE, utmSource: "bing" })).toBe("organic_search");
    expect(touchChannel({ ...NONE, utmSource: "youtube", utmMedium: "social" })).toBe("organic_social");
  });

  it("falls to the page before: a search engine, a social site, another site; ours and the payment page are none", () => {
    expect(touchChannel({ ...NONE, referrer: "https://www.google.co.in/" })).toBe("organic_search");
    expect(touchChannel({ ...NONE, referrer: "https://l.instagram.com/?u=x" })).toBe("organic_social");
    expect(touchChannel({ ...NONE, referrer: "https://example.com/hair" })).toBe("referral_site");
    expect(touchChannel({ ...NONE, referrer: "https://app.maneman.in/visits" })).toBe("direct");
    expect(touchChannel({ ...NONE, referrer: "https://api.razorpay.com/pay" })).toBe("direct");
    expect(touchChannel({ ...NONE, referrer: "not a link" })).toBe("direct");
  });

  it("is what a call was put under, where the call carried nothing else", () => {
    expect(touchChannel({ ...NONE, via: "call", declared: "meta_ads" })).toBe("meta_ads");
    expect(touchChannel({ ...NONE, via: "call", declared: "meta_ads", code: "friend" })).toBe("referral");
  });

  it("is WhatsApp or Phone for a chat or a call with nothing to go on, and Direct for a visit", () => {
    expect(touchChannel({ ...NONE, via: "whatsapp" })).toBe("whatsapp");
    expect(touchChannel({ ...NONE, via: "call" })).toBe("phone");
    expect(touchChannel(NONE)).toBe("direct");
  });
});

describe("whether a touch moves the last touch", () => {
  it("does for anything a campaign put there, and not for a plain visit or a referrer alone", () => {
    expect(carriesCampaign({ ...NONE, utmCampaign: "gurgaon-search" })).toBe(true);
    expect(carriesCampaign({ ...NONE, utmCampaign: null, gbraid: "x" })).toBe(true);
    expect(carriesCampaign({ ...NONE, utmCampaign: null, code: "society" })).toBe(true);
    expect(carriesCampaign({ ...NONE, utmCampaign: null, via: "call", declared: "google_ads" })).toBe(true);
    expect(carriesCampaign({ ...NONE, utmCampaign: null })).toBe(false);
    expect(carriesCampaign({ ...NONE, utmCampaign: null, referrer: "https://www.google.com/" })).toBe(false);
  });
});

describe("a client's channel", () => {
  it("is their first touch's, unless a code reached us before their first consultation was booked", () => {
    expect(clientChannel("google_ads", new Set())).toBe("google_ads");
    expect(clientChannel("google_ads", new Set(["society"]))).toBe("society");
    expect(clientChannel("direct", new Set(["society", "partner"]))).toBe("partner");
    expect(clientChannel("meta_ads", new Set(["society", "partner", "friend"]))).toBe("referral");
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
