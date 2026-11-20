// A chat begun from a link on the site (site/src/lib/contact-clicks.ts; ADR 0288): with the visitor's reference kept,
// the chat opens with the page's greeting and the reference at its end, so the chat Care see carries where the visit
// came from; words a link already has keep theirs; without a reference, the link is left as it is.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { watchContactLinks } from "../../site/src/lib/contact-clicks.ts";

const CHAT = "https://wa.me/919034572990";

let link: HTMLAnchorElement;

beforeAll(() => {
  watchContactLinks();
});

beforeEach(() => {
  // jsdom's storage: a Node with a localStorage of its own (25 on) hides it. CI's Node (.nvmrc) has none.
  const { jsdom } = globalThis as unknown as { jsdom?: { window: Window } };
  if (jsdom !== undefined) vi.stubGlobal("localStorage", jsdom.window.localStorage);
  localStorage.clear();
  Reflect.set(window, "dataLayer", []);
  document.body.dataset.chatGreeting = "Hi, I’d like to know more.";
  link = document.createElement("a");
  link.href = CHAT;
  // The click is read, not followed.
  link.addEventListener("click", (event) => {
    event.preventDefault();
  });
  document.body.append(link);
});

afterEach(() => {
  link.remove();
  vi.unstubAllGlobals();
});

describe("a chat begun from a link", () => {
  it("opens with the page's greeting and the visitor's reference", () => {
    localStorage.setItem("mm_ref", "7KQ3M9XP");
    link.click();

    expect(new URL(link.href).searchParams.get("text")).toBe("Hi, I’d like to know more. Ref 7KQ3M9XP");
  });

  it("keeps a link's own words, the reference after them, once", () => {
    localStorage.setItem("mm_ref", "7KQ3M9XP");
    link.href = `${CHAT}?text=${encodeURIComponent("About my visit")}`;
    link.click();
    link.click();

    expect(new URL(link.href).searchParams.get("text")).toBe("About my visit Ref 7KQ3M9XP");
  });

  it("is left as it is while no reference is kept", () => {
    link.click();

    expect(link.href).toBe(CHAT);
  });
});
