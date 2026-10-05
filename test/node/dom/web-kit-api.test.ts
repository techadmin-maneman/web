// The front ends' one way to mm-api (packages/web-kit/api.ts): each call is
// typed from the OpenAPI document of its surface, its path, query and body
// included, and every answer is read the same way -- what a success carries,
// what a refusal says, what counts as no connection, and the one place a
// session that has ended is heard.

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createClient,
  type Answer,
  type CallOptions,
  type OperationAt,
  type PathOf,
  type Success,
} from "../../../packages/web-kit/api.ts";

/** A surface's document, as openapi-typescript writes it, cut to what the tests call. */
interface Paths {
  "/api/visits/{id}": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    get: {
      parameters: { query?: never; header?: never; path: { id: string }; cookie?: never };
      requestBody?: never;
      responses: { 200: { headers: Record<string, unknown>; content: { "application/json": { id: string } } } };
    };
  };
  "/api/availability": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    get: {
      parameters: { query: { type: string; moving?: string }; header?: never; path?: never; cookie?: never };
      requestBody?: never;
      responses: { 200: { headers: Record<string, unknown>; content: { "application/json": { days: string[] } } } };
    };
  };
  "/api/auth/otp": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { "application/json": { mobile: string } } };
      responses: {
        202: { headers: Record<string, unknown>; content: { "application/json": { challenge_id: string } } };
      };
    };
  };
  "/api/auth/logout": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody?: never;
      responses: { 204: { headers: Record<string, unknown>; content?: never } };
    };
  };
}

type Code = "not_found" | "invalid_request" | "unauthorized" | "superseded";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

/** Answers every call with `response`, and keeps what was sent. */
function answering(response: () => Response): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve(response());
  });
  return sent;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const refusal = (status: number, code: string, fields?: string[]) =>
  json(status, { error: { code, request_id: "t", ...(fields === undefined ? {} : { fields }) } });

describe("a call", () => {
  it("fills in its path, and asks with the session's cookie", async () => {
    const sent = answering(() => json(200, { id: "a/b" }));
    const answer = await createClient<Paths, Code>().get("/api/visits/{id}", { path: { id: "a/b" } });
    expect(sent[0]?.url).toBe("/api/visits/a%2Fb");
    expect(sent[0]?.init).toMatchObject({ method: "GET", credentials: "same-origin" });
    expect(answer).toEqual({ ok: true, status: 200, body: { id: "a/b" }, cached: false });
  });

  it("puts what it is given into the query, and leaves out what it is not", async () => {
    const sent = answering(() => json(200, { days: [] }));
    await createClient<Paths, Code>().get("/api/availability", { query: { type: "service" } });
    expect(sent[0]?.url).toBe("/api/availability?type=service");
  });

  it("sends its body as JSON", async () => {
    const sent = answering(() => json(202, { challenge_id: "c" }));
    const answer = await createClient<Paths, Code>().post("/api/auth/otp", { body: { mobile: "9810000001" } });
    expect(sent[0]?.init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: "9810000001" }),
    });
    expect(answer).toMatchObject({ ok: true, status: 202, body: { challenge_id: "c" } });
  });

  it("answers null for a success with nothing in it", async () => {
    answering(() => new Response(null, { status: 204 }));
    expect(await createClient<Paths, Code>().post("/api/auth/logout")).toMatchObject({ ok: true, body: null });
  });

  it("says when the answer came from the service worker's copy", async () => {
    answering(() => json(200, { id: "a" }, { "Mm-Served-From": "cache" }));
    const answer = await createClient<Paths, Code>().get("/api/visits/{id}", { path: { id: "a" } });
    expect(answer).toMatchObject({ ok: true, cached: true });
  });

  // The console's photographs: a file, not JSON, refused and lapsed like any other call.
  it("answers a file as it came, when asked for one", async () => {
    answering(() => new Response(new Blob(["jpeg"], { type: "image/jpeg" }), { status: 200 }));
    const answer = await createClient<Paths, Code>().request<Blob>("GET", "/api/photo", { file: true });
    if (!answer.ok) throw new Error("refused");
    expect(answer.body.type).toBe("image/jpeg");
    expect(await answer.body.text()).toBe("jpeg");
  });

  it("reads a refused file's code as any other refusal's", async () => {
    answering(() => refusal(404, "not_found"));
    const answer = await createClient<Paths, Code>().request<Blob>("GET", "/api/photo", { file: true });
    expect(answer).toMatchObject({ ok: false, status: 404, code: "not_found" });
  });
});

describe("a refusal", () => {
  it("carries the API's code and the fields it refused", async () => {
    answering(() => refusal(400, "invalid_request", ["mobile"]));
    const answer = await createClient<Paths, Code>().post("/api/auth/otp", { body: { mobile: "1" } });
    expect(answer).toEqual({
      ok: false,
      status: 400,
      code: "invalid_request",
      fields: ["mobile"],
      moved: null,
      requestId: "t",
    });
  });

  // The screen shows it, so whoever is told "it failed" can find the call in the logs.
  it("carries the API's ID for the call, from the refusal or else from its header", async () => {
    answering(() => refusal(500, "internal_error"));
    expect(await createClient<Paths, Code>().get("/api/visits/{id}", { path: { id: "a" } })).toMatchObject({
      requestId: "t",
    });

    answering(() => new Response("", { status: 502, headers: { "X-Request-Id": "from-the-header" } }));
    expect(await createClient<Paths, Code>().get("/api/visits/{id}", { path: { id: "a" } })).toMatchObject({
      requestId: "from-the-header",
    });

    answering(() => new Response("", { status: 502 }));
    expect(await createClient<Paths, Code>().get("/api/visits/{id}", { path: { id: "a" } })).toMatchObject({
      requestId: null,
    });
  });

  // Open point 92: a technician's write for a job ops gave to someone else names them, by first name, and when.
  it("carries whom a superseded job went to, and when", async () => {
    const moved = { technician: "Sameer", at: "2027-01-14T05:10:00.000Z" };
    answering(() => json(409, { error: { code: "superseded", request_id: "t", fields: ["technician"], moved } }));
    const answer = await createClient<Paths, Code>().get("/api/visits/{id}", { path: { id: "a" } });
    expect(answer).toEqual({
      ok: false,
      status: 409,
      code: "superseded",
      fields: ["technician"],
      moved,
      requestId: "t",
    });
  });

  it("is `unknown` when the API gave no code, unless the app says what such a status means", async () => {
    answering(() => new Response("", { status: 409 }));
    const plain = await createClient<Paths, Code>().get("/api/visits/{id}", { path: { id: "a" } });
    expect(plain).toMatchObject({ ok: false, status: 409, code: "unknown" });
    const told = createClient<Paths, Code>({ missingCode: (status) => (status === 409 ? "superseded" : "unknown") });
    expect(await told.get("/api/visits/{id}", { path: { id: "a" } })).toMatchObject({ code: "superseded" });
  });
});

describe("a session that has ended", () => {
  it("is heard in one place, with the API's code, whichever call met it", async () => {
    const heard: string[] = [];
    answering(() => refusal(401, "unauthorized"));
    const client = createClient<Paths, Code>({ onSessionEnded: (code) => heard.push(code) });
    const answer = await client.get("/api/visits/{id}", { path: { id: "a" } });
    expect(answer).toMatchObject({ ok: false, status: 401, code: "unauthorized" });
    expect(heard).toEqual(["unauthorized"]);
  });

  it("is not heard for any other refusal", async () => {
    const heard: string[] = [];
    answering(() => refusal(404, "not_found"));
    await createClient<Paths, Code>({ onSessionEnded: (code) => heard.push(code) }).get("/api/visits/{id}", {
      path: { id: "a" },
    });
    expect(heard).toEqual([]);
  });

  it("can be told apart by the app, as the console tells Access's redirect to its login", async () => {
    const heard: string[] = [];
    answering(() => Response.redirect("https://team.cloudflareaccess.com/login", 302));
    const client = createClient<Paths, Code>({
      redirect: "manual",
      sessionEnded: (response) => response.status === 302,
      onSessionEnded: (code) => heard.push(code),
    });
    const answer = await client.get("/api/visits/{id}", { path: { id: "a" } });
    expect(answer).toMatchObject({ ok: false, code: "unknown" });
    expect(heard).toEqual(["unknown"]);
  });
});

describe("no connection", () => {
  it("is a call that never reached the API", async () => {
    let unreached = 0;
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const client = createClient<Paths, Code>({ onUnreached: () => (unreached += 1) });
    const answer = await client.get("/api/visits/{id}", { path: { id: "a" } });
    expect(answer).toEqual({ ok: false, status: 0, code: "offline", fields: [], moved: null, requestId: null });
    expect(unreached).toBe(1);
  });

  it("is an answer that is not the API's, rather than a page left loading for ever", async () => {
    // A Wi-Fi sign-in page, answering 200 with HTML in place of the API.
    answering(() => new Response("<html>Log in to the Wi-Fi</html>", { status: 200 }));
    const answer = await createClient<Paths, Code>().get("/api/visits/{id}", { path: { id: "a" } });
    expect(answer).toMatchObject({ ok: false, status: 0, code: "offline" });
  });

  it("is a signal that never answers, given up on after the app's patience", async () => {
    neverAnswering();
    const client = createClient<Paths, Code>({ patience: { read: 4_000, write: 9_000 } });
    const answer = client.get("/api/visits/{id}", { path: { id: "a" } });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await answer).toMatchObject({ ok: false, code: "offline" });
  });

  it("waits a write's patience for anything but a GET", async () => {
    neverAnswering();
    const client = createClient<Paths, Code>({ patience: { read: 4_000, write: 9_000 } });
    const answer = settled(client.post("/api/auth/otp", { body: { mobile: "9810000001" } }));
    await vi.advanceTimersByTimeAsync(8_999);
    expect(answer.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer.value).toMatchObject({ ok: false, code: "offline" });
  });

  it("waits a call's own patience, where it names one, in place of the client's", async () => {
    neverAnswering();
    const client = createClient<Paths, Code>({ patience: { read: 4_000, write: 9_000 } });
    const answer = settled(client.request("PUT", "/api/upload", { body: "jpeg", patience: 60_000 }));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(answer.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer.value).toMatchObject({ ok: false, code: "offline" });
  });

  // An app that sets no patience no longer waits as long as the browser does.
  it("is given up on after a minute when the app sets no patience", async () => {
    neverAnswering();
    const answer = settled(createClient<Paths, Code>().get("/api/visits/{id}", { path: { id: "a" } }));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(answer.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer.value).toMatchObject({ ok: false, code: "offline" });
  });
});

/** A fetch that never answers until it is given up on, on the test's own clock. */
function neverAnswering(): void {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("gave up", "AbortError"));
        });
      }),
  );
}

/** A call's answer once it has one, so a test can see it has none yet. */
function settled<T>(call: Promise<T>): { value: T | undefined } {
  const seen: { value: T | undefined } = { value: undefined };
  void call.then((value) => {
    seen.value = value;
  });
  return seen;
}

describe("every answer that reached the API", () => {
  it("is shown to the app once read, as the client app sets its clock and the technician app its signal", async () => {
    const seen: number[] = [];
    answering(() => json(200, { id: "a" }));
    await createClient<Paths, Code>({ onAnswer: (response) => seen.push(response.status) }).get("/api/visits/{id}", {
      path: { id: "a" },
    });
    expect(seen).toEqual([200]);
  });
});

// Checked when the tests are type-checked (npm run typecheck), not when they run.
describe("the types each call is given and answers with", () => {
  it("are the document's", () => {
    expectTypeOf<PathOf<Paths, "get">>().toEqualTypeOf<"/api/visits/{id}" | "/api/availability">();
    expectTypeOf<Success<OperationAt<Paths, "/api/visits/{id}", "get">>>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<Success<OperationAt<Paths, "/api/auth/logout", "post">>>().toEqualTypeOf<null>();
    expectTypeOf<CallOptions<OperationAt<Paths, "/api/auth/otp", "post">>>()
      .toHaveProperty("body")
      .toEqualTypeOf<{ mobile: string }>();
    expectTypeOf<CallOptions<OperationAt<Paths, "/api/visits/{id}", "get">>>()
      .toHaveProperty("path")
      .toEqualTypeOf<{ id: string }>();
  });

  it("answer a refusal with one of the document's codes, or the client's own", () => {
    type Refused = Extract<Answer<unknown, Code>, { ok: false }>["code"];
    expectTypeOf<Refused>().toEqualTypeOf<Code | "offline" | "unknown">();
  });
});
