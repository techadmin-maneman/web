// Customer Care · Messages in the console (apps/ops/src/care/; docs/decisions/0129-the-care-inbox.md,
// 0131-care-people.md, 0134-care-cover.md): the chats a view at a time, a chat opened with our automatic messages in
// it, its client moved to another Care person or a matter sent to their city, and the Care team's days off. Every name,
// number and address is made up.

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../apps/ops/src/care/care-api.ts";
import {
  CareTeamScreen,
  MessagesScreen,
  QuickRepliesScreen,
  RemediesScreen,
} from "../../apps/ops/src/care/MessagesScreen.tsx";
import { care as copy } from "../../apps/ops/src/content/care.ts";
import { shortDate } from "../../packages/web-kit/dates.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";
import { RECORD } from "../../e2e/ops/fixtures/clients.ts";
import { openDialogsAsJsdomCan } from "./dialogs.ts";
import { Shell } from "../../apps/ops/src/components/Shell.tsx";

const ARJUN: Conversation = {
  id: "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e",
  person: { id: "11111111-1111-4111-8111-111111111111", name: "Arjun Mehta" },
  mobile: "+919810000001",
  state: "open",
  care_person: "asha@maneman.test",
  covered_by: null,
  technician: null,
  last_message_at: "2026-09-21T05:12:00.000Z",
  last_line: "Can I move tomorrow’s visit to the evening?",
  waiting_since: "2026-09-21T05:12:00.000Z",
  reply_by: "2026-09-21T06:12:00.000Z",
};
const STRANGER: Conversation = {
  ...ARJUN,
  id: "9d2e0a5c-6f7b-4c8d-0e9f-4a5b6c7d8e9f",
  person: null,
  care_person: null,
  mobile: "+919811112222",
  last_line: "Do you come to Noida?",
};

const LEAVE = { id: "7b0c8e3a-4d59-4a6b-8c7d-2e3f4a5b6c7d", from: "2026-10-20", to: "2026-10-22" };

const LATE = {
  id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
  title: "See you soon",
  text: "Hi {name}, see you {next_visit}.",
};

const AWAITING = {
  id: "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e",
  person: { id: "11111111-1111-4111-8111-111111111111", name: "Arjun Mehta" },
  visits: 2,
  reason: "fit_problem",
  note: "Edge lifting.",
  given_by: "care@maneman.test",
  given_at: "2026-09-21T05:30:00.000Z",
  state: "awaiting",
};

let page: HTMLDivElement;
let root: Root;
let asked: string[];
let posted: { path: string; body: unknown }[];

beforeEach(() => {
  // The drawers open beside the page, as modal dialogs (../../apps/ops/src/components/FormDrawer.tsx).
  openDialogsAsJsdomCan();
  asked = [];
  posted = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const address = new URL(url, "https://ops.maneman.test");
      asked.push(`${address.pathname}${address.search}`);
      if (init?.method === "POST" && typeof init.body === "string") {
        posted.push({ path: address.pathname, body: JSON.parse(init.body) as unknown });
        if (address.pathname.endsWith("/city-matter")) return Promise.resolve(Response.json({ city: "Gurgaon" }));
        if (address.pathname === "/api/clients/find") {
          const found = {
            id: ARJUN.person?.id,
            name: "Arjun Mehta",
            mobile: "+919810000001",
            state: "fitted",
            next_visit: null,
            under_way: false,
          };
          return Promise.resolve(Response.json({ clients: [found], more: false }));
        }
        if (address.pathname === "/api/quick-replies") return Promise.resolve(Response.json(LATE));
        if (address.pathname.endsWith("/remedies"))
          return Promise.resolve(Response.json({ id: AWAITING.id, state: "given" }));
        if (address.pathname.startsWith("/api/remedies/")) return Promise.resolve(Response.json({ ok: true }));
        if (address.pathname.endsWith("/link") || address.pathname.endsWith("/save")) {
          return Promise.resolve(Response.json({ person_id: ARJUN.person?.id }));
        }
        if (address.pathname.endsWith("/care-person")) {
          return Promise.resolve(Response.json({ care_person: "ravi@maneman.test" }));
        }
        if (address.pathname === "/api/care-team/leave") return Promise.resolve(Response.json({ id: LEAVE.id }));
        if (address.pathname === "/api/care-team/move-all") return Promise.resolve(Response.json({ moved: 12 }));
        if (address.pathname.startsWith("/api/care-team/")) return Promise.resolve(Response.json({ ok: true }));
        const replied = {
          kind: "out",
          at: "2026-09-21T05:20:00.000Z",
          author: "care@maneman.test",
          text: "Yes, 6 pm works.",
          delivery: "sent",
        };
        return Promise.resolve(Response.json({ conversation: { ...ARJUN, state: "waiting" }, items: [replied] }));
      }
      if (address.pathname === "/api/care-team") {
        return Promise.resolve(
          Response.json({
            team: [
              {
                email: "ravi@maneman.test",
                on_team: true,
                name: null,
                clients: 3,
                weekly_off: [0],
                leave: [],
                off_today: false,
                covered_by: null,
                on_shift_since: "2026-09-21T03:30:00.000Z",
                day_off: false,
                open_chats: 1,
              },
              {
                email: "asha@maneman.test",
                on_team: true,
                name: "Asha",
                clients: 12,
                weekly_off: [],
                leave: [LEAVE],
                off_today: true,
                covered_by: "ravi@maneman.test",
                on_shift_since: null,
                day_off: false,
                open_chats: 2,
              },
            ],
            me: "ravi@maneman.test",
          }),
        );
      }
      if (address.pathname === "/api/conversations") {
        const view = address.searchParams.get("view");
        return Promise.resolve(
          Response.json({ conversations: view === "closed" ? [] : [ARJUN, STRANGER], next_cursor: null }),
        );
      }
      if (address.pathname === "/api/quick-replies") return Promise.resolve(Response.json({ replies: [LATE] }));
      if (address.pathname === "/api/remedies") return Promise.resolve(Response.json({ remedies: [AWAITING] }));
      if (address.pathname === `/api/clients/${ARJUN.person?.id ?? ""}`) {
        const [booked] = RECORD.visits.upcoming;
        const visit = { ...booked, date: "2026-09-24", starts_at: "2026-09-24T06:30:00.000Z" };
        return Promise.resolve(
          Response.json({
            ...RECORD,
            id: ARJUN.person?.id,
            name: "Arjun Mehta",
            mobile: ARJUN.mobile,
            visits: { upcoming: [visit], past: [] },
            credits: { visits: 2, earliest_expiry: null },
          }),
        );
      }
      if (address.pathname === `/api/conversations/${STRANGER.id}`) {
        return Promise.resolve(Response.json({ conversation: STRANGER, items: [] }));
      }
      if (address.pathname === `/api/conversations/${ARJUN.id}`) {
        return Promise.resolve(
          Response.json({
            conversation: ARJUN,
            items: [
              {
                kind: "auto",
                at: "2026-09-20T04:00:01.000Z",
                message: "visit_reminder",
                state: "sent",
                delivered_at: "2026-09-20T04:00:05.000Z",
                read_at: null,
              },
              { kind: "in", at: ARJUN.last_message_at, author: "client", text: ARJUN.last_line, delivery: null },
            ],
          }),
        );
      }
      return Promise.resolve(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
    }),
  );
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

const settle = () => answered();

async function show() {
  act(() => {
    root.render(createElement(MessagesScreen));
  });
  await settle();
}

/** Care's three Settings pages, drawn together in the console's frame: the team, the remedies and the quick replies. */
async function showSettings() {
  act(() => {
    root.render(
      createElement(Shell, {
        route: { page: "settings", tab: "quick-replies" },
        children: createElement(
          Fragment,
          null,
          createElement(CareTeamScreen),
          createElement(RemediesScreen),
          createElement(QuickRepliesScreen),
        ),
      }),
    );
  });
  await settle();
}

describe("the Messages page", () => {
  it("lists the chats waiting on us, a number we don’t know by that", async () => {
    await show();
    expect(asked).toContain("/api/conversations?view=open");
    expect(document.body.textContent).toContain("Arjun Mehta");
    expect(document.body.textContent).toContain(ARJUN.last_line);
    expect(document.body.textContent).toContain(copy.unknown);
    expect(document.body.textContent).toContain(copy.overdue(""));
  });

  it("opens a chat with our automatic messages in it, and how far each got", async () => {
    await show();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`button[aria-label="${copy.openLabel("Arjun Mehta")}"]`)?.click();
      await answered();
    });
    expect(document.body.textContent).toContain(copy.thread.title("Arjun Mehta"));
    expect(document.body.textContent).toContain(copy.thread.auto("Visit reminder", [copy.thread.delivered]));
    expect(document.body.textContent).toContain(copy.thread.client);
  });

  it("shows another view when one is chosen", async () => {
    await show();
    const select = document.body.querySelector("select");
    await act(async () => {
      if (select !== null) {
        select.value = "closed";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await answered();
    });
    expect(asked).toContain("/api/conversations?view=closed");
    expect(document.body.textContent).toContain(copy.none);
  });

  it("shows each chat’s Care person, and asks for my clients' chats as Mine", async () => {
    await show();
    expect(document.body.textContent).toContain("asha@maneman.test");
    const select = document.body.querySelector("select");
    await act(async () => {
      if (select !== null) {
        select.value = "mine";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await answered();
    });
    expect(asked).toContain("/api/conversations?view=mine");
  });

  it("moves the client to another of the Care team", async () => {
    await show();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`button[aria-label="${copy.openLabel("Arjun Mehta")}"]`)?.click();
      await answered();
    });
    expect(document.body.textContent).toContain(`${copy.carePerson.label}: asha@maneman.test`);
    const choice = [...document.body.querySelectorAll("select")].find((each) =>
      [...each.options].some((option) => option.value === "ravi@maneman.test"),
    );
    expect(choice?.textContent).toContain(copy.carePerson.member("ravi@maneman.test", 3));
    await act(async () => {
      if (choice !== undefined) {
        choice.value = "ravi@maneman.test";
        choice.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await answered();
    });
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((each) => each.textContent.trim() === copy.carePerson.move)
        ?.click();
      await answered();
    });
    expect(posted).toEqual([
      { path: "/api/clients/11111111-1111-4111-8111-111111111111/care-person", body: { email: "ravi@maneman.test" } },
    ]);
    expect(document.body.textContent).toContain(copy.carePerson.moved("ravi@maneman.test"));
    expect(document.body.textContent).toContain(`${copy.carePerson.label}: ravi@maneman.test`);
  });

  it("fills a quick reply in with the client’s first name and next visit", async () => {
    await show();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`button[aria-label="${copy.openLabel("Arjun Mehta")}"]`)?.click();
      await answered();
    });
    const pick = [...document.body.querySelectorAll("select")].find((each) =>
      [...each.options].some((option) => option.value === LATE.id),
    );
    await act(async () => {
      if (pick !== undefined) {
        pick.value = LATE.id;
        pick.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await answered();
    });
    const box = [...document.body.querySelectorAll("textarea")].find((each) => each.maxLength === 4096);
    expect(box?.value).toBe("Hi Arjun, see you Thu 24 Sep, 12 pm.");
  });

  it("keeps the quick replies, adding one", async () => {
    await showSettings();
    const list = document.body.querySelector('[aria-labelledby="quick-replies"]') ?? page;
    expect(list.textContent).toContain(LATE.title);
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((each) => each.textContent.trim() === copy.quick.addOne)
        ?.click();
    });
    const title = document.body.querySelector<HTMLInputElement>('input[maxlength="60"]');
    const text = [...document.body.querySelectorAll("textarea")].find((each) => each.maxLength === 1000);
    act(() => {
      for (const [field, value] of [
        [title, "Running late"],
        [text, "Hi {name}, about 20 minutes away."],
      ] as const) {
        if (field === null || field === undefined) continue;
        const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      [...document.body.querySelectorAll("button")].find((each) => each.textContent.trim() === copy.quick.add)?.click();
      await answered();
    });
    expect(posted.at(-1)).toEqual({
      path: "/api/quick-replies",
      body: { title: "Running late", text: "Hi {name}, about 20 minutes away." },
    });
  });

  it("gives free visits from the chat, with why", async () => {
    await show();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`button[aria-label="${copy.openLabel("Arjun Mehta")}"]`)?.click();
      await answered();
    });
    const press = async (label: string) => {
      await act(async () => {
        [...document.body.querySelectorAll("button")].find((each) => each.textContent.trim() === label)?.click();
        await answered();
      });
    };
    await press(copy.remedy.open);
    const note = [...document.body.querySelectorAll("textarea")].find((each) => each.maxLength === 300);
    act(() => {
      if (note !== undefined) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(note, "Edge lifting.");
        note.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await press(copy.remedy.give);
    expect(posted.at(-1)).toEqual({
      path: `/api/clients/${ARJUN.person?.id ?? ""}/remedies`,
      body: { visits: 1, reason: "fit_problem", note: "Edge lifting." },
    });
    expect(document.body.textContent).toContain(copy.remedy.given(1));
  });

  it("lets a manager approve a remedy awaiting them", async () => {
    await showSettings();
    const panel = document.body.querySelector('[aria-labelledby="remedies"]') ?? page;
    expect(panel.textContent).toContain(copy.remedy.states.awaiting);
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(`button[aria-label="${copy.remedy.approveLabel("Arjun Mehta")}"]`)
        ?.click();
      await answered();
    });
    expect(asked).toContain(`/api/remedies/${AWAITING.id}/approve`);
  });

  it("shows the client beside the chat, with the ways into their page", async () => {
    await show();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`button[aria-label="${copy.openLabel("Arjun Mehta")}"]`)?.click();
      await answered();
    });
    const panel = document.body.querySelector(`[aria-label="${copy.panel.title}"]`);
    expect(panel?.textContent).toContain(copy.panel.visit("Thu 24 Sep, 12 pm", "Service visit"));
    expect(panel?.textContent).toContain("Gurgaon");
    expect(panel?.querySelector(`a[href$="/payments"]`)?.textContent).toBe(copy.panel.links.payments);
  });

  it("sends a matter from the chat to the client’s city", async () => {
    await show();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`button[aria-label="${copy.openLabel("Arjun Mehta")}"]`)?.click();
      await answered();
    });
    const press = async (label: string) => {
      await act(async () => {
        [...document.body.querySelectorAll("button")].find((each) => each.textContent.trim() === label)?.click();
        await answered();
      });
    };
    await press(copy.cityMatter.open);
    const box = [...document.body.querySelectorAll("textarea")].find((each) => each.maxLength === 300);
    act(() => {
      if (box !== undefined) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "Needs a re-fit.");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await press(copy.cityMatter.send);
    expect(posted.at(-1)).toEqual({
      path: `/api/conversations/${ARJUN.id}/city-matter`,
      body: { note: "Needs a re-fit." },
    });
    expect(document.body.textContent).toContain(copy.cityMatter.sent("Gurgaon"));
  });

  it("links a stranger’s chat to the client it turns out to be, or saves them as someone new", async () => {
    await show();
    const click = async (element: Element | null | undefined) => {
      await act(async () => {
        (element as HTMLElement | null | undefined)?.click();
        await answered();
      });
    };
    const type = (input: HTMLInputElement | undefined, value: string) => {
      act(() => {
        if (input === undefined) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    // The list's own search box sits above, so each box is looked for in the stranger's panel.
    const panel = () => document.body.querySelector(`section[aria-label="${copy.stranger.title}"]`) ?? page;
    const named = (text: string) =>
      [...panel().querySelectorAll("button")].find((each) => each.textContent.trim() === text);
    await click(document.body.querySelector(`button[aria-label="${copy.openLabel(STRANGER.mobile)}"]`));
    expect(document.body.textContent).toContain(copy.stranger.title);
    type(panel().querySelector<HTMLInputElement>('input[maxlength="60"]') ?? undefined, "Arjun");
    await click(named(copy.stranger.search));
    await click(document.body.querySelector(`button[aria-label="${copy.stranger.linkLabel("Arjun Mehta")}"]`));
    expect(posted.at(-1)).toEqual({
      path: `/api/conversations/${STRANGER.id}/link`,
      body: { person_id: ARJUN.person?.id },
    });
    type(panel().querySelector<HTMLInputElement>('input[maxlength="80"]') ?? undefined, "Meera Iyer");
    const foundUs = [...panel().querySelectorAll("select")].find((each) =>
      each.querySelector('option[value="partner"]'),
    );
    act(() => {
      if (foundUs === undefined) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(foundUs, "partner");
      foundUs.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(named(copy.stranger.save));
    expect(posted.at(-1)).toEqual({
      path: `/api/conversations/${STRANGER.id}/save`,
      body: { name: "Meera Iyer", found_us: "partner" },
    });
  });

  it("lists the Care team with their days off and leave", async () => {
    await showSettings();
    const team = document.body.querySelector('[aria-labelledby="care-team"]') ?? page;
    expect(team.textContent).toContain("ravi@maneman.test");
    expect(team.textContent).toContain(copy.team.weekdays[0]);
    expect(team.textContent).toContain(copy.team.period(shortDate(LEAVE.from), shortDate(LEAVE.to)));
    expect(team.textContent).toContain(copy.team.offShift + copy.team.coveredBy("ravi@maneman.test"));
    expect(team.textContent).toContain(copy.team.you.on("9 am"));
  });

  it("moves every client of one member to another", async () => {
    await showSettings();
    await act(async () => {
      page
        .querySelector<HTMLButtonElement>(`button[aria-label="${copy.team.moveAllLabel("ravi@maneman.test")}"]`)
        ?.click();
      await answered();
    });
    await act(async () => {
      [...document.body.querySelectorAll("button")].find((each) => each.textContent.trim() === copy.team.move)?.click();
      await answered();
    });
    expect(posted.at(-1)).toEqual({
      path: "/api/care-team/move-all",
      body: { from: "ravi@maneman.test", to: "asha@maneman.test" },
    });
  });

  it("takes the signed-in member off shift", async () => {
    await showSettings();
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((each) => each.textContent.trim() === copy.team.goOff)
        ?.click();
      await answered();
    });
    expect(posted.at(-1)).toEqual({ path: "/api/care-team/shift", body: { on: false } });
  });

  it("sets the name clients know a member by", async () => {
    await showSettings();
    await act(async () => {
      page
        .querySelector<HTMLButtonElement>(`button[aria-label="${copy.team.editNameLabel("ravi@maneman.test")}"]`)
        ?.click();
      await answered();
    });
    const box = document.body.querySelector<HTMLInputElement>('input[maxlength="40"]');
    act(() => {
      if (box !== null) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, "Ravi");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      [...document.body.querySelectorAll("button")].find((each) => each.textContent.trim() === copy.team.save)?.click();
      await answered();
    });
    expect(posted.at(-1)).toEqual({ path: "/api/care-team/name", body: { email: "ravi@maneman.test", name: "Ravi" } });
    expect(document.body.textContent).toContain("Asha");
  });

  it("sets a member’s days off, adds leave and takes it back", async () => {
    await showSettings();
    const click = async (element: Element | null | undefined) => {
      await act(async () => {
        (element as HTMLElement | null | undefined)?.click();
        await answered();
      });
    };
    const button = (label: string) => document.body.querySelector(`button[aria-label="${label}"]`);
    const named = (text: string) =>
      [...document.body.querySelectorAll("button")].find((each) => each.textContent.trim() === text);
    await click(button(copy.team.editDaysLabel("ravi@maneman.test")));
    const monday = [...document.body.querySelectorAll('input[type="checkbox"]')][1];
    await click(monday);
    await click(named(copy.team.save));
    expect(posted.at(-1)).toEqual({
      path: "/api/care-team/days-off",
      body: { email: "ravi@maneman.test", weekdays: [0, 1] },
    });
    await click(button(copy.team.addLeaveLabel("asha@maneman.test")));
    const dates = [...document.body.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    act(() => {
      for (const [input, value] of [
        [dates[0], "2026-11-02"],
        [dates[1], "2026-11-03"],
      ] as const) {
        if (input === undefined) continue;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await click(named(copy.team.add));
    expect(posted.at(-1)).toEqual({
      path: "/api/care-team/leave",
      body: { email: "asha@maneman.test", from: "2026-11-02", to: "2026-11-03" },
    });
    await click(button(copy.team.takeBackLabel(copy.team.period(shortDate(LEAVE.from), shortDate(LEAVE.to)))));
    expect(asked).toContain(`/api/care-team/leave/${LEAVE.id}/delete`);
  });

  it("replies from our number, adds a note, and closes the chat with what it was about", async () => {
    await show();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(`button[aria-label="${copy.openLabel("Arjun Mehta")}"]`)?.click();
      await answered();
    });
    const box = document.body.querySelector("textarea");
    act(() => {
      if (box !== null) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "Yes, 6 pm works.");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const press = async (label: string) => {
      await act(async () => {
        [...document.body.querySelectorAll("button")].find((each) => each.textContent.trim() === label)?.click();
        await answered();
      });
    };
    await press(copy.compose.send);
    expect(posted).toEqual([{ path: `/api/conversations/${ARJUN.id}/replies`, body: { text: "Yes, 6 pm works." } }]);
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe(copy.compose.sent);
    await press(copy.compose.closeChat);
    expect(posted.at(-1)).toEqual({ path: `/api/conversations/${ARJUN.id}/close`, body: { reason: "other" } });
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe(copy.compose.closed);
  });
});
