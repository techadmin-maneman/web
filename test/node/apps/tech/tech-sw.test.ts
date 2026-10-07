// What the technician app's service worker answers, and from where
// (apps/tech/sw/requests.ts): the shell from what it keeps, the day's list from
// the network with its copy behind it, and never a card, an address or a number.

import { describe, expect, it } from "vitest";
import { answerFor } from "../../../../apps/tech/sw/requests.ts";

const ORIGIN = "https://tech.maneman.in";
const get = (path: string, mode = "cors") => ({ method: "GET", mode, url: `${ORIGIN}${path}` });

describe("what the service worker answers", () => {
  it("answers every page with the app it keeps, whatever the path", () => {
    expect(answerFor(get("/", "navigate"), ORIGIN)).toBe("shell");
    expect(answerFor(get("/jobs/a0000000-0000-4000-8000-000000000001", "navigate"), ORIGIN)).toBe("shell");
  });

  it("sends a page marked for Access's sign-in to the network, where Access can sign the founder in again", () => {
    expect(answerFor(get("/jobs/a0000000-0000-4000-8000-000000000001?signin=", "navigate"), ORIGIN)).toBeNull();
  });

  it("answers the app's own files from what it keeps", () => {
    expect(answerFor(get("/assets/index-abc.js"), ORIGIN)).toBe("file");
    expect(answerFor(get("/manifest.webmanifest"), ORIGIN)).toBe("file");
  });

  it("keeps a copy of the day's list, which names a client but carries no address or number", () => {
    expect(answerFor(get("/api/tech/jobs?date=2030-09-01"), ORIGIN)).toBe("day");
  });

  it("leaves a card, who is signed in, a piece and a photograph to the network alone", () => {
    expect(answerFor(get("/api/tech/jobs/a0000000-0000-4000-8000-000000000001"), ORIGIN)).toBeNull();
    expect(answerFor(get("/api/tech/me"), ORIGIN)).toBeNull();
    expect(answerFor(get("/api/tech/pieces/lookup?code=MM-1&job=a"), ORIGIN)).toBeNull();
    expect(answerFor({ method: "PUT", mode: "cors", url: `${ORIGIN}/api/tech/photos/t` }, ORIGIN)).toBeNull();
  });

  it("never touches a write, or another host's request", () => {
    expect(answerFor({ method: "POST", mode: "cors", url: `${ORIGIN}/api/tech/jobs/a/start` }, ORIGIN)).toBeNull();
    expect(answerFor(get("/", "navigate"), "https://maneman.in")).toBeNull();
  });
});
