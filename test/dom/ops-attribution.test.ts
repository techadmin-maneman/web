// The console's say over attribution (ADR 0288): Campaign links listed with what each brought, and a society
// activation's link made with its costs and offer; How they found us on a client's page, what they told ops kept and
// their sharing stopped; and a lead taken on a call under the channel picked. Every name and number here is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignLinksScreen } from "../../apps/ops/src/campaign-links/CampaignLinksScreen.tsx";
import { CallLead, CallTakenLine } from "../../apps/ops/src/clients/CallLead.tsx";
import { FoundUs } from "../../apps/ops/src/clients/FoundUs.tsx";
import { LeadStages } from "../../apps/ops/src/clients/LeadStages.tsx";
import { leadStages as leadCopy } from "../../apps/ops/src/content/lead-stages.ts";
import { campaignLinks as linksCopy } from "../../apps/ops/src/content/campaign-links.ts";
import { foundUs as copy } from "../../apps/ops/src/content/found-us.ts";
import { spend as spendCopy } from "../../apps/ops/src/content/spend.ts";
import { SpendScreen } from "../../apps/ops/src/spend/SpendScreen.tsx";
import { PageHead } from "../../apps/ops/src/frame/PageHead.tsx";
import { openDialogsAsJsdomCan } from "./dialogs.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const LINK = "33333333-3333-4333-8333-333333333333";
const CODE = "44444444-4444-4444-8444-444444444444";

const GREEN_VALLEY = {
  id: LINK,
  kind: "society",
  slug: "green-valley-towers",
  code: "GV2345",
  name: "Green Valley Towers",
  utm_source: "society",
  utm_medium: "offline",
  utm_campaign: "green-valley-towers-20260926",
  city: "Gurgaon",
  pincode: "122002",
  held_date: "2026-09-26",
  discount_code: null,
  short_link: "https://maneman.in/s/green-valley-towers",
  created_by: "growth@maneman.in",
  created_at: "2026-09-21T06:30:00.000Z",
  retired_at: null,
  spent: 500_000,
  touches: 12,
  people: 3,
};

const LINKS = {
  links: [GREEN_VALLEY],
  discount_codes: [{ id: CODE, code: "SOC20", kind: "percent", value: 20, expires_on: null }],
  sources: ["google", "meta", "youtube", "whatsapp", "newsletter", "partner"],
  mediums: ["cpc", "paid_social", "social", "email", "offline"],
  cities: ["Gurgaon"],
};

const FOUND = {
  attributed_channel: "society",
  last_touch_channel: "google_ads",
  first_touch: {
    at: "2026-09-19T06:30:00.000Z",
    via: "site",
    channel: "society",
    utm_source: "society",
    utm_medium: "offline",
    utm_campaign: "green-valley-towers-20260926",
    landing_path: "/book",
    referrer: null,
    link_name: "Green Valley Towers",
  },
  last_touch: {
    at: "2026-09-20T06:30:00.000Z",
    via: "site",
    channel: "google_ads",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "gurgaon-search",
    landing_path: "/",
    referrer: null,
    link_name: null,
  },
  touches: 2,
  heard_from: null,
  heard_from_other: null,
  heard_from_at: null,
  sharing_stopped_at: null,
  became_lead_at: "2026-09-19T06:30:00.000Z",
  first_reply_at: "2026-09-19T06:41:00.000Z",
  qualified_at: "2026-09-20T07:00:00.000Z",
  attended_at: null,
  fitted_at: null,
  lost_reason: null,
  lost_objection: null,
  lost_at: null,
};

let page: HTMLElement;
let actions: HTMLElement;
let root: Root;
let answers: Map<string, () => Response>;
let sent: { path: string; body: unknown }[];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  openDialogsAsJsdomCan();
  answers = new Map();
  sent = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: { method?: string; body?: unknown }) => {
      const path = new URL(url, "https://ops.maneman.test").pathname;
      const method = init?.method ?? "GET";
      if (method === "POST") sent.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const reply = answers.get(`${method} ${path}`);
      const refused = () => Response.json({ error: { code: "unavailable", request_id: "request-1" } }, { status: 503 });
      return Promise.resolve((reply ?? refused)());
    }),
  );
  page = document.createElement("div");
  actions = document.createElement("div");
  document.body.append(actions, page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  actions.remove();
  vi.unstubAllGlobals();
});

/** The element in a head with room for its actions, as the frame draws it. */
async function show(element: React.ReactElement) {
  const head = {
    setSub: () => undefined,
    setOver: () => undefined,
    setRecord: () => undefined,
    setHeading: () => undefined,
    setRecordHead: () => undefined,
    actions,
    aside: null,
  };
  act(() => {
    root.render(createElement(PageHead.Provider, { value: head }, element));
  });
  await answered();
}

const button = (name: string) =>
  [...document.body.querySelectorAll("button")].find(
    (each) => each.textContent.trim() === name || each.getAttribute("aria-label") === name,
  );

async function click(name: string) {
  await act(async () => {
    button(name)?.click();
    await answered();
  });
}

/** The box a label names, anywhere on the page or in an open drawer. */
function box(label: string): HTMLInputElement | HTMLSelectElement {
  const named = [...document.body.querySelectorAll("label")].find((each) => each.textContent.trim().startsWith(label));
  const found = named === undefined ? null : document.getElementById(named.htmlFor);
  if (!(found instanceof HTMLInputElement || found instanceof HTMLSelectElement)) throw new Error(`no box: ${label}`);
  return found;
}

function fill(label: string, value: string) {
  const target = box(label);
  const prototype = target instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, value);
    target.dispatchEvent(new Event(target instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("Campaign links", () => {
  it("lists each link with what it brought, and makes a society's with its costs and offer", async () => {
    answers.set("GET /api/campaign-links", () => Response.json(LINKS));
    answers.set("POST /api/campaign-links", () => Response.json(GREEN_VALLEY, { status: 201 }));
    await show(createElement(CampaignLinksScreen));

    expect(page.textContent).toContain("Green Valley Towers");
    expect(page.textContent).toContain(GREEN_VALLEY.short_link);
    expect(page.textContent).toContain("Rs. 5,000");

    await click(linksCopy.newSociety);
    fill(linksCopy.society.name, "Palm Grove");
    fill(linksCopy.society.pincode, "122002");
    fill(linksCopy.society.stall, "2000");
    fill(linksCopy.society.staffHours, "3");
    fill(linksCopy.society.staffRate, "500");
    fill(linksCopy.discount, CODE);
    await click(linksCopy.make);

    expect(sent).toEqual([
      {
        path: "/api/campaign-links",
        body: {
          kind: "society",
          name: "Palm Grove",
          pincode: "122002",
          held_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
          costs: [
            { line: "stall", amount: 200_000 },
            { line: "staff", amount: 150_000, note: "3 h × Rs. 500" },
          ],
          discount_code_id: CODE,
        },
      },
    ]);
  });
});

describe("A society's costs", () => {
  it("keep Make link waiting, the box named, while one holds more than whole digits or staff is half typed", async () => {
    answers.set("GET /api/campaign-links", () => Response.json(LINKS));
    await show(createElement(CampaignLinksScreen));
    await click(linksCopy.newSociety);
    fill(linksCopy.society.name, "Palm Grove");
    fill(linksCopy.society.pincode, "122002");
    const make = () => button(linksCopy.make);

    fill(linksCopy.society.stall, "2,000");
    expect(make()?.disabled).toBe(true);
    expect(document.body.textContent).toContain(linksCopy.missing.figures.stall);

    fill(linksCopy.society.stall, "2000");
    fill(linksCopy.society.staffHours, "3");
    expect(make()?.disabled).toBe(true);
    expect(document.body.textContent).toContain(linksCopy.missing.staff);

    fill(linksCopy.society.staffRate, "500");
    expect(make()?.disabled).toBe(false);
  });
});

describe("Copying a campaign link", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("says so each time, and where the link is when the browser keeps the clipboard", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    answers.set("GET /api/campaign-links", () => Response.json(LINKS));
    await show(createElement(CampaignLinksScreen));

    await click(linksCopy.copyLabel("Green Valley Towers"));
    expect(writeText).toHaveBeenCalledWith(GREEN_VALLEY.short_link);
    expect(document.body.textContent).toContain(linksCopy.copied);
    expect(page.textContent).not.toContain(linksCopy.notCopied);

    writeText.mockRejectedValue(new DOMException("Refused", "NotAllowedError"));
    await click(linksCopy.copyLabel("Green Valley Towers"));
    expect(page.textContent).toContain(linksCopy.notCopied);
  });
});

/** The job sheet's lost reasons, as the client's record lists them. */
const REASONS = [
  { code: "price", label: "The price" },
  { code: "not_ready", label: "Not ready yet" },
];

describe("A client's lead", () => {
  it("gives each stage's day, or not yet, and keeps a lead lost with why and their words", async () => {
    answers.set(`GET /api/clients/${PERSON}/attribution`, () => Response.json(FOUND));
    answers.set(`POST /api/clients/${PERSON}/lost`, () => new Response(null, { status: 204 }));
    await show(createElement(LeadStages, { clientId: PERSON, reasons: REASONS }));

    expect(page.textContent).toContain(leadCopy.rows.firstReply);
    expect(page.textContent).toContain("19 Sep");
    expect(page.textContent).toContain(leadCopy.notYet);
    expect(page.textContent).not.toContain(leadCopy.rows.objection);

    await click(`Change ${leadCopy.rows.lost}`);
    fill(leadCopy.rows.lost, "not_ready");
    await click("Save");
    expect(sent.at(-1)).toEqual({ path: `/api/clients/${PERSON}/lost`, body: { lost_reason: "not_ready" } });
  });

  it("marks an objection not given as a gap, never a blank", async () => {
    const lost = { ...FOUND, lost_reason: "price", lost_at: FOUND.became_lead_at };
    answers.set(`GET /api/clients/${PERSON}/attribution`, () => Response.json(lost));
    await show(createElement(LeadStages, { clientId: PERSON, reasons: REASONS }));
    expect(page.textContent).toContain(`${leadCopy.rows.objection}—`);
  });

  it("takes a lead lost back, and keeps their objection when the reason changes", async () => {
    const lost = {
      ...FOUND,
      lost_reason: "price",
      lost_objection: "Waiting for a bonus",
      lost_at: FOUND.became_lead_at,
    };
    answers.set(`GET /api/clients/${PERSON}/attribution`, () => Response.json(lost));
    answers.set(`POST /api/clients/${PERSON}/lost`, () => new Response(null, { status: 204 }));
    await show(createElement(LeadStages, { clientId: PERSON, reasons: REASONS }));
    expect(page.textContent).toContain("Waiting for a bonus");
    expect(page.textContent).toContain(leadCopy.rows.lostOn);
    expect(page.textContent).toContain("The price");

    await click(`Change ${leadCopy.rows.lost}`);
    fill(leadCopy.rows.lost, "not_ready");
    await click("Save");
    expect(sent.at(-1)).toEqual({
      path: `/api/clients/${PERSON}/lost`,
      body: { lost_reason: "not_ready", lost_objection: "Waiting for a bonus" },
    });

    await click(`Change ${leadCopy.rows.lost}`);
    fill(leadCopy.rows.lost, "");
    await click("Save");
    expect(sent.at(-1)).toEqual({ path: `/api/clients/${PERSON}/lost`, body: { lost_reason: null } });
  });
});

describe("How they found us", () => {
  it("shows the channel and touches, keeps what they told ops, and stops their sharing", async () => {
    answers.set(`GET /api/clients/${PERSON}/attribution`, () => Response.json(FOUND));
    answers.set(`POST /api/clients/${PERSON}/heard-from`, () => new Response(null, { status: 204 }));
    answers.set(`POST /api/clients/${PERSON}/stop-sharing`, () => new Response(null, { status: 204 }));
    await show(createElement(FoundUs, { clientId: PERSON, name: "Rohit Malhotra" }));

    expect(page.textContent).toContain("Society activations");
    expect(page.textContent).toContain(copy.link("Green Valley Towers"));
    expect(page.textContent).toContain("gurgaon-search");

    await click(`Change ${copy.rows.heardFrom}`);
    fill(copy.rows.heardFrom, "youtube");
    await click("Save");
    expect(sent.at(-1)).toEqual({ path: `/api/clients/${PERSON}/heard-from`, body: { heard_from: "youtube" } });

    await click(copy.stopping.label("Rohit Malhotra"));
    await click(copy.stopping.confirm);
    expect(sent.at(-1)).toEqual({ path: `/api/clients/${PERSON}/stop-sharing`, body: null });
  });

  it("offers Not asked yet only while no answer is kept", async () => {
    const choices = () => [...(box(copy.rows.heardFrom) as HTMLSelectElement).options].map((each) => each.text);
    answers.set(`GET /api/clients/${PERSON}/attribution`, () => Response.json(FOUND));
    await show(createElement(FoundUs, { clientId: PERSON, name: "Rohit Malhotra" }));
    await click(`Change ${copy.rows.heardFrom}`);
    expect(choices()).toContain(copy.notAsked);

    act(() => {
      root.unmount();
    });
    root = createRoot(page);
    answers.set(`GET /api/clients/${PERSON}/attribution`, () =>
      Response.json({ ...FOUND, heard_from: "google", heard_from_at: "2026-09-21T06:30:00.000Z" }),
    );
    await show(createElement(FoundUs, { clientId: PERSON, name: "Rohit Malhotra" }));
    await click(`Change ${copy.rows.heardFrom}`);
    expect(choices()).not.toContain(copy.notAsked);
  });
});

describe("A lead from a call", () => {
  it("is saved under the channel Care picked", async () => {
    answers.set("POST /api/leads/call", () => Response.json({ person_id: PERSON, known: false }));
    const taken: unknown[] = [];
    await show(
      createElement(CallLead, {
        onTaken: (done) => {
          taken.push(done);
        },
      }),
    );

    await click(copy.call.open);
    fill(copy.call.name, "Vikram Rao");
    fill(copy.call.mobile, "9811113333");
    fill(copy.call.channel, "society");
    await click(copy.call.save);

    expect(sent).toEqual([
      { path: "/api/leads/call", body: { name: "Vikram Rao", mobile: "9811113333", channel: "society" } },
    ]);
    expect(taken).toEqual([{ personId: PERSON, known: false }]);
  });

  // The pincode is their city until they give an address (docs/decisions/0307-the-people-rulings.md).
  it("sends the pincode given, and waits for one it can read before it sends anything", async () => {
    answers.set("POST /api/leads/call", () => Response.json({ person_id: PERSON, known: false }));
    await show(createElement(CallLead, { onTaken: () => undefined }));

    await click(copy.call.open);
    fill(copy.call.name, "Vikram Rao");
    fill(copy.call.mobile, "9811113333");
    fill(copy.call.channel, "society");
    fill(copy.call.pincode, "0122");
    expect(document.body.textContent).toContain(copy.call.missing.pincode);
    fill(copy.call.pincode, "122018");
    await click(copy.call.save);

    expect(sent).toEqual([
      {
        path: "/api/leads/call",
        body: { name: "Vikram Rao", mobile: "9811113333", channel: "society", pincode: "122018" },
      },
    ]);
  });

  it("says on the page what it took, with the way to their record, until the next", async () => {
    await show(createElement(CallTakenLine, { taken: { personId: PERSON, known: true } }));

    expect(page.textContent).toContain(copy.call.known);
    const record = [...page.querySelectorAll("a")].find((each) => each.textContent === copy.call.open_client);
    expect(record?.getAttribute("href")).toBe(`/clients/${PERSON}/referrals`);
  });
});

describe("A spend import", () => {
  it("says how many rows it took once the list is read again", async () => {
    answers.set("GET /api/spend", () =>
      Response.json({
        entries: [],
        cities: ["Gurgaon"],
        channels: ["google_ads", "meta_ads"],
        first_day: "2025-09-01",
        today: "2026-09-21",
      }),
    );
    answers.set("POST /api/spend/import", () => Response.json({ added: 2 }));
    await show(createElement(SpendScreen));
    await click(spendCopy.importOne);

    const file = box(spendCopy.import.file) as HTMLInputElement;
    const csv = [
      "Campaign report",
      "Day,Campaign,Cost",
      "2026-09-19,gurgaon-search,1250.00",
      "2026-09-20,brand,300.00",
    ];
    Object.defineProperty(file, "files", { value: [new File([csv.join(String.fromCharCode(10))], "campaigns.csv")] });
    await act(async () => {
      file.dispatchEvent(new Event("change", { bubbles: true }));
      await answered();
    });
    await click(spendCopy.import.submit);

    expect(sent.at(-1)?.path).toBe("/api/spend/import");
    expect(document.body.textContent).toContain(spendCopy.import.done(2));
  });
});
