// The mark that sends an app's page past its service worker to Access's sign-in, and comes off once the page is back
// (packages/web-kit/access.ts).

import { describe, expect, it } from "vitest";
import { markedForSignIn, unmarked } from "../../../packages/web-kit/access.ts";
import { answerFor } from "../../../packages/web-kit/sw-requests.ts";

const PAGE = "https://app-staging.maneman.in/visits?tab=past#top";

describe("the sign-in mark", () => {
  it("is what each app's service worker leaves to the network, so the page reaches Access", () => {
    const page = { method: "GET", mode: "navigate", url: markedForSignIn(PAGE) };
    expect(answerFor(page, "https://app-staging.maneman.in", { path: "/api/me", answer: "home" })).toBeNull();
  });

  it("keeps the page's own path, query and fragment, so the founder comes back to where they were", () => {
    const marked = new URL(markedForSignIn(PAGE));
    expect(marked.pathname).toBe("/visits");
    expect(marked.searchParams.get("tab")).toBe("past");
    expect(marked.hash).toBe("#top");
    expect(unmarked(marked.href)).toBe(PAGE);
  });

  it("is nothing to take off a page that carries none", () => {
    expect(unmarked(PAGE)).toBeNull();
  });
});
