// What a push shows on the client's phone (apps/app/sw/alert-notice.ts): one notification each push, saying how many
// alerts are new, or that one is where the inbox could not be read, and a tap that opens the inbox. And the worker,
// built as one classic file, imports nothing the app imports, which would split it into chunks it cannot load.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { noticeOf, OPENS, unreadIn, WORDS } from "../../../../apps/app/sw/alert-notice.ts";

const inbox = (...read: boolean[]) => ({
  alerts: read.map((each, index) => ({ id: `a${String(index)}`, read: each })),
});

describe("a push on the client's phone", () => {
  it("counts the inbox's alerts not yet read", () => {
    expect(unreadIn(inbox(false, true, false))).toBe(2);
    expect(unreadIn(inbox(true))).toBe(0);
  });

  it("reads anything but the inbox as not read at all", () => {
    expect(unreadIn(null)).toBeNull();
    expect(unreadIn({ error: "unauthorised" })).toBeNull();
    expect(unreadIn({ alerts: "none" })).toBeNull();
  });

  it("says how many are new where more than one is", () => {
    expect(noticeOf(3)).toMatchObject({ title: WORDS.title, body: "You have 3 new updates.", tag: "mm-alerts" });
  });

  it("still shows one notification, saying there is an update, for one, none or an inbox it could not read", () => {
    for (const unread of [1, 0, null]) expect(noticeOf(unread).body).toBe(WORDS.one);
  });

  it("opens the inbox", () => {
    expect(OPENS).toBe("/alerts");
  });
});

describe("the client app's worker", () => {
  it("imports only its own files and the web kit's worker files, never the app's", () => {
    const imports = readdirSync("apps/app/sw")
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) => [...readFileSync(`apps/app/sw/${name}`, "utf8").matchAll(/from "([^"]+)"/g)])
      .map((match) => match[1] ?? "")
      .filter((path) => !path.startsWith("./"));
    // The web kit's worker files are written for workers alone, and bundled into the worker's one file.
    expect(imports.filter((path) => !/^(\.\.\/)+packages\/web-kit\/sw-[a-z-]+\.ts$/.test(path))).toEqual([]);
  });
});
