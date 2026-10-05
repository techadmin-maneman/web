// The one fetch every vendor call goes through (src/providers/vendor-fetch.ts), and the reading of a vendor's answer
// by its schema (src/providers/vendor-answer.ts). Eight adapters each hand-rolled fetch, timeout
// and error mapping, four of them logged nothing per call, and an answer that failed a schema reached ops as a zod dump.

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger, failureReason } from "../../src/log.ts";
import { isRefusal } from "../../src/providers/provider-error.ts";
import { parseAnswer, UnexpectedAnswer, vendorAnswerOf, type VendorAnswer } from "../../src/providers/vendor-answer.ts";
import { vendorFetch, VendorUnreachable, type VendorCall } from "../../src/providers/vendor-fetch.ts";
import { captureLogs, fakeFetch, json } from "./helpers.ts";

const URL_WITH_KEY = "https://api.vendor.test/v1/orders?key=secret-key";
const CALL: VendorCall = { vendor: "razorpay", step: "create_order", timeoutMs: 10_000 };

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});

const vendorCalls = () => logs.lines().filter((line) => line.event === "vendor_call");

const failing =
  (error: Error): typeof fetch =>
  () =>
    Promise.reject(error);

describe("vendorFetch", () => {
  it("logs one line for an answered call, with its vendor, step, status and time, and never the URL", async () => {
    const http = fakeFetch({ "https://api.vendor.test/": () => json({ id: "order_1" }, 201) });

    const response = await vendorFetch({ fetch: http.fetch, log: createLogger() }, CALL, URL_WITH_KEY, {
      method: "POST",
    });

    expect(response).toBeInstanceOf(Response);
    expect(await (response as Response).json()).toEqual({ id: "order_1" });
    expect(http.calls.map((call) => call.method)).toEqual(["POST"]);
    expect(vendorCalls()).toEqual([
      expect.objectContaining({ level: "info", vendor: "razorpay", step: "create_order", status: 201 }),
    ]);
    expect(typeof vendorCalls()[0]?.duration_ms).toBe("number");
    expect(JSON.stringify(vendorCalls())).not.toMatch(/https:|secret-key/);
  });

  it("logs the vendor's own code on a failed answer, and leaves the answer for the adapter to read", async () => {
    const http = fakeFetch({ "https://api.vendor.test/": () => json({ error: { code: "BAD_REQUEST_ERROR" } }, 400) });
    const codeOf = (body: unknown) => (body as { error: { code: string } }).error.code;

    const response = await vendorFetch({ fetch: http.fetch, log: createLogger() }, { ...CALL, codeOf }, URL_WITH_KEY);

    expect(await (response as Response).json()).toEqual({ error: { code: "BAD_REQUEST_ERROR" } });
    expect(vendorCalls()).toEqual([expect.objectContaining({ status: 400, code: "BAD_REQUEST_ERROR" })]);
  });

  it("reads no code where the vendor has none to read, or the answer is not JSON", async () => {
    const http = fakeFetch({ "https://api.vendor.test/": () => new Response("Bad Gateway", { status: 502 }) });
    const deps = { fetch: http.fetch, log: createLogger() };

    await vendorFetch(deps, CALL, URL_WITH_KEY);
    await vendorFetch(deps, { ...CALL, codeOf: (body) => (body === null ? null : "read") }, URL_WITH_KEY);

    expect(vendorCalls().map((line) => line.code)).toEqual([undefined, null]);
  });

  it("gives each call its own time limit", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const watching: typeof fetch = (_input, init) => {
      signals.push(init?.signal);
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    await vendorFetch({ fetch: watching, log: createLogger() }, CALL, URL_WITH_KEY);
    expect(signals).toEqual([expect.any(AbortSignal)]);
  });

  it("answers a timeout as a VendorUnreachable naming the vendor, the step and the limit, never a refusal", async () => {
    const timedOut = failing(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

    const reply = await vendorFetch({ fetch: timedOut, log: createLogger() }, CALL, URL_WITH_KEY);

    expect(reply).toBeInstanceOf(VendorUnreachable);
    expect(reply).toMatchObject({ status: 0, code: "TIMEOUT", timedOut: true, reason: "TimeoutError" });
    expect(failureReason(reply)).toBe("Razorpay 0 TIMEOUT: create_order got no answer within 10 s");
    expect(isRefusal(reply)).toBe(false);
    expect(vendorCalls()).toEqual([
      expect.objectContaining({
        level: "warn",
        vendor: "razorpay",
        step: "create_order",
        status: 0,
        reason: "TimeoutError",
      }),
    ]);
  });

  it("answers a vendor it cannot reach by the error's name alone, which never holds the URL", async () => {
    const reply = await vendorFetch(
      { fetch: failing(new TypeError(`could not connect to ${URL_WITH_KEY}`)), log: createLogger() },
      { vendor: "zoho-books", step: "record_payment", timeoutMs: 20_000 },
      URL_WITH_KEY,
    );

    expect(reply).toMatchObject({ code: "UNREACHABLE", timedOut: false, reason: "TypeError" });
    expect(failureReason(reply)).toBe("Zoho Books 0 UNREACHABLE: record_payment could not be reached (TypeError)");
    expect(JSON.stringify(logs.lines())).not.toContain("secret-key");
  });

  it("names a thrown value that is not an error as unknown", async () => {
    const throwsAString: typeof fetch = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a fetch stub may throw anything
      throw "down";
    };
    const reply = await vendorFetch({ fetch: throwsAString, log: createLogger() }, CALL, URL_WITH_KEY);
    expect(reply).toMatchObject({ code: "UNREACHABLE", reason: "unknown" });
  });
});

describe("reading a vendor's answer", () => {
  const answer = (body: unknown): VendorAnswer => ({ vendor: "Razorpay", step: "create_order", status: 200, body });

  it("reads JSON, and an empty 204 as no body", async () => {
    expect(await vendorAnswerOf("Razorpay", "create_order", json({ id: "order_1" }))).toEqual(
      answer({ id: "order_1" }),
    );
    expect(await vendorAnswerOf("Zoho", "search", new Response(null, { status: 204 }))).toEqual({
      vendor: "Zoho",
      step: "search",
      status: 204,
      body: null,
    });
  });

  it("names an answer that is not JSON as an unexpected one, not a refusal", async () => {
    const failure = vendorAnswerOf("Razorpay", "create_order", new Response("<html>Service unavailable</html>"));
    await expect(failure).rejects.toBeInstanceOf(UnexpectedAnswer);
    await expect(failure).rejects.toMatchObject({
      status: 200,
      code: "UNEXPECTED_ANSWER",
      refusal: false,
      message: "Razorpay 200 UNEXPECTED_ANSWER: create_order: the answer is not JSON",
    });
  });

  it("passes on a body it could not read at all", async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new TypeError("stream broke"));
      },
    });
    await expect(vendorAnswerOf("Razorpay", "create_order", new Response(broken))).rejects.toThrow("stream broke");
  });

  it("answers what the schema reads, from the top or from under a path", () => {
    expect(parseAnswer(z.object({ id: z.string() }), answer({ id: "order_1", entity: "order" }))).toEqual({
      id: "order_1",
    });
    expect(parseAnswer(z.string(), answer({ invoice: { invoice_id: "inv-1" } }), ["invoice", "invoice_id"])).toBe(
      "inv-1",
    );
  });

  it("names the step, where the answer differs and the keys found there, and none of its values", () => {
    const misfit = () =>
      parseAnswer(
        z.object({ items: z.array(z.object({ status: z.string() })) }),
        answer({ items: [{ status: "captured" }, { id: "pay_2", contact: "+919810000001" }] }),
      );
    expect(misfit).toThrow(UnexpectedAnswer);
    expect(misfit).toThrow(
      "Razorpay 200 UNEXPECTED_ANSWER: create_order: items.1.status: Invalid input: expected string, received " +
        "undefined; items.1 has keys id, contact",
    );
    expect(misfit).not.toThrow(/9810000001/);
  });

  it("names a misfit under a path from the top of the answer", () => {
    expect(() => parseAnswer(z.string(), answer({ invoice: { total: 10 } }), ["invoice", "invoice_id"])).toThrow(
      "create_order: invoice.invoice_id: Invalid input: expected string, received undefined; invoice has keys total",
    );
  });

  it("names an answer that is wrong as a whole", () => {
    expect(() => parseAnswer(z.object({ id: z.string() }), answer([1, 2]))).toThrow(
      "create_order: the answer: Invalid input: expected object, received array",
    );
  });

  it("tells a value by its kind, a list by its length, and many keys by the first ten", () => {
    const manyKeys = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`key${String(index)}`, index]));
    const read = z.object({ data: z.object({ id: z.string() }) });

    expect(() => parseAnswer(read, answer({ data: { ...manyKeys } }))).toThrow(
      "data has keys key0, key1, key2, key3, key4, key5, key6, key7, key8, key9, …",
    );
    expect(() => parseAnswer(z.object({ data: z.array(z.string()) }), answer({ data: [1] }))).toThrow(
      "data.0: Invalid input: expected string, received number; data has a list of 1",
    );
    expect(() => parseAnswer(z.object({ data: z.object({ id: z.string() }) }), answer({ data: {} }))).toThrow(
      "data has no keys",
    );
    expect(() => parseAnswer(read, answer({ data: null }))).toThrow(
      "data: Invalid input: expected object, received null",
    );
    expect(() => parseAnswer(z.object({ a: z.object({ b: z.string() }) }), answer({ a: { b: 1 } }))).toThrow(
      "a.b: Invalid input: expected string, received number; a has keys b",
    );
  });

  it("names, for a choice of shapes, where the first shape differs", () => {
    const either = z.union([z.object({ id: z.string() }), z.object({ code: z.number() })]);
    expect(() => parseAnswer(either, answer({ name: "x" }))).toThrow(
      "create_order: id: Invalid input: expected string, received undefined; the answer has keys name",
    );
  });
});
