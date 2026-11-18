// A try-on look WhatsApp refused, shown once in the client app (apps/app/src/photos/refused-look.ts,
// docs/decisions/0276-a-message-whatsapp-refuses.md): Photos opens once the API takes it as shown, and not when it
// refuses, or when Home names none. Every ID is made up.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRefusedLook } from "../../apps/app/src/photos/refused-look.ts";
import { answered, renderHook } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const LOOK = "66666666-6666-4666-8666-000000000004";

let asked: string[];
let shown: number;

beforeEach(() => {
  asked = [];
  shown = 204;
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "fetch",
    contractChecked("client", (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? "GET"} ${new URL(url, "https://app.maneman.test").pathname}`);
      return Promise.resolve(
        shown === 204
          ? new Response(null, { status: 204 })
          : Response.json({ error: { code: "not_found", request_id: "r" } }, { status: 404 }),
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a look WhatsApp refused", () => {
  it("opens Photos once the API takes it as shown", async () => {
    const hook = renderHook(useRefusedLook, LOOK);
    await answered();
    expect(asked).toEqual([`POST /api/photos/try-on/${LOOK}/shown`]);
    await vi.waitFor(() => {
      expect(window.location.pathname).toBe("/photos");
    });
    hook.unmount();
  });

  it("stays where it is when the API says it was shown already", async () => {
    shown = 404;
    const hook = renderHook(useRefusedLook, LOOK);
    await answered();
    expect(asked).toEqual([`POST /api/photos/try-on/${LOOK}/shown`]);
    expect(window.location.pathname).toBe("/");
    hook.unmount();
  });

  it("asks nothing when Home names no look", async () => {
    const hook = renderHook(useRefusedLook, null);
    await answered();
    expect(asked).toEqual([]);
    hook.unmount();
  });
});
