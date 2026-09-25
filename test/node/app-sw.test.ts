// What the client app's service worker answers, and from where
// (apps/app/sw/requests.ts): the shell from what it keeps, Home from the
// network with its copy behind it, and no other answer of the API's.

import { describe, expect, it } from "vitest";
import { answerFor } from "../../apps/app/sw/requests.ts";

const ORIGIN = "https://app.maneman.in";
const get = (path: string, mode = "cors") => ({ method: "GET", mode, url: `${ORIGIN}${path}` });

describe("what the client app's service worker answers", () => {
  it("answers every page with the app it keeps, whatever the path", () => {
    expect(answerFor(get("/", "navigate"), ORIGIN)).toBe("shell");
    expect(answerFor(get("/payments/a0000000-0000-4000-8000-000000000001", "navigate"), ORIGIN)).toBe("shell");
  });

  it("answers the app's own files from what it keeps", () => {
    expect(answerFor(get("/assets/index-abc.js"), ORIGIN)).toBe("file");
    expect(answerFor(get("/manifest.webmanifest"), ORIGIN)).toBe("file");
  });

  it("keeps a copy of Home, for board B3's offline state", () => {
    expect(answerFor(get("/api/me"), ORIGIN)).toBe("home");
  });

  it("leaves every other answer of the API's to the network alone, photographs and documents included", () => {
    expect(answerFor(get("/api/visits"), ORIGIN)).toBeNull();
    expect(answerFor(get("/api/photos"), ORIGIN)).toBeNull();
    expect(answerFor(get("/api/documents/a"), ORIGIN)).toBeNull();
    expect(answerFor(get("/api/me/export"), ORIGIN)).toBeNull();
  });

  it("never touches a write, or another host's request", () => {
    expect(answerFor({ method: "POST", mode: "cors", url: `${ORIGIN}/api/holds` }, ORIGIN)).toBeNull();
    const checkout = { method: "GET", mode: "no-cors", url: "https://checkout.razorpay.com/v1/checkout.js" };
    expect(answerFor(checkout, ORIGIN)).toBeNull();
  });
});
