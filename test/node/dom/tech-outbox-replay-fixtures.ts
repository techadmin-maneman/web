// What the outbox replay tests share (tech-outbox-replay, tech-outbox-refusals): the API faked, its answers, and a
// photograph taken.

import "fake-indexeddb/auto";
import { vi } from "vitest";

export interface Sent {
  readonly method: string;
  readonly url: string;
  readonly eventId: string | null;
  readonly startsAt: string | null;
}

/**
 * The API at fetch: `answer` says what each call gets, by method and path, and
 * by what was sent where it needs to, and every call is recorded in order. A
 * thrown TypeError is how fetch says there is no signal.
 */
export function api(
  answer: (method: string, url: string, body: unknown) => { status: number; json?: unknown } | "offline",
) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    sent.push({
      method,
      url,
      eventId: headers.get("X-Client-Event-Id"),
      startsAt: headers.get("X-Job-Starts-At"),
    });
    const given = answer(method, url, init.body);
    if (given === "offline") return Promise.reject(new TypeError("Failed to fetch"));
    const body = given.json === undefined ? null : JSON.stringify(given.json);
    return Promise.resolve(
      new Response(body, { status: given.status, headers: { "Content-Type": "application/json" } }),
    );
  });
  return sent;
}

export const accepted = {
  status: 202,
  json: { event_id: "e", replayed: false, fsm_write_state: "pending", progress: {} },
};

export type Answer = ReturnType<Parameters<typeof api>[0]>;

/** The take the fake API names for every photograph. */
export const TAKE = "0192a8e4-0000-7000-8000-00000000a0a0";

/** The photographs' calls answered as the API does, and each thumbnail as `small` says. */
export const answerPhotos =
  (small: () => Answer) =>
  (method: string, url: string): Answer => {
    if (url.endsWith("/upload-url")) {
      const links = { upload_url: "/api/tech/photos/t", small_upload_url: "/api/tech/photos/t/small", expires_at: "" };
      return { status: 201, json: links };
    }
    if (method !== "PUT") return accepted;
    return url.includes("/small") ? small() : { status: 200, json: { take: TAKE } };
  };
