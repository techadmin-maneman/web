import { describe, expect, it } from "vitest";
import { REDACTED, createLogger, isRedactedField, redact, scrubString } from "../../src/log.ts";
import { captureLogs } from "./helpers.ts";

describe("redact", () => {
  it("redacts name, mobile, email and image keys by field name, in any casing, at any depth", () => {
    const out = redact({
      person: { name: "Arjun Mehta", Mobile: "+919876543210", mobileE164: "+919876543210", email: "a@b.in" },
      zoho: { Last_Name: "Mehta", Email: "a@b.in" },
      job: { upload_key: "uploads/2026/abc.jpg", resultKey: "results/abc.png", provider_result_url: "https://oss/x" },
      list: [{ phone: "9876543210" }],
    });

    expect(out).toEqual({
      person: { name: REDACTED, Mobile: REDACTED, mobileE164: REDACTED, email: REDACTED },
      zoho: { Last_Name: REDACTED, Email: REDACTED },
      job: { upload_key: REDACTED, resultKey: REDACTED, provider_result_url: REDACTED },
      list: [{ phone: REDACTED }],
    });
  });

  it("redacts credentials, including the AILabTools key header", () => {
    expect(
      redact({ "ailabapi-api-key": "k", authorization: "Bearer x", refresh_token: "r", Cookie: "mm_tryon=1" }),
    ).toEqual({
      "ailabapi-api-key": REDACTED,
      authorization: REDACTED,
      refresh_token: REDACTED,
      Cookie: REDACTED,
    });
  });

  it("keeps operational fields", () => {
    const fields = { event: "lead_created", lead_id: "0b0c…", state: "queued", ip_hash: "h", status: 201 };
    expect(redact(fields)).toEqual(fields);
    expect(isRedactedField("ip_hash")).toBe(false);
  });

  it("masks e-mail addresses and Indian mobile numbers inside free text", () => {
    expect(scrubString("Zoho said: duplicate Mobile 9876543210 for dev@example.com")).toBe(
      `Zoho said: duplicate Mobile ${REDACTED} for ${REDACTED}`,
    );
    for (const mobile of ["+91 98765 43210", "+919876543210", "09876543210", "91-9876543210", "98765-43210"]) {
      expect(scrubString(`call ${mobile} now`)).toBe(`call ${REDACTED} now`);
    }
  });

  it("leaves timestamps, UUIDs and short numbers alone", () => {
    const text = "at 1789979968215 job 5f0e6a3c-9876-4321-8a3b-123456789012 took 49000 ms";
    expect(scrubString(text)).toBe(text);
  });

  // About one UUID in 270 ends in ten digits starting 6-9, which read as a mobile number.
  it("leaves an ID alone even where it reads as a mobile number", () => {
    const id = "cb72f987-b7b9-4398-914a-9876543210d2";
    expect(scrubString(id)).toBe(id);
    expect(scrubString("cb72f987-b7b9-4398-914a-987654321012")).toBe("cb72f987-b7b9-4398-914a-987654321012");
  });

  it("serialises errors with a scrubbed message and stack", () => {
    const error = new Error("rejected 9876543210");
    const out = redact({ error }) as { error: { name: string; message: string; stack?: string } };
    expect(out.error.name).toBe("Error");
    expect(out.error.message).toBe(`rejected ${REDACTED}`);
    expect(out.error.stack).not.toContain("9876543210");
  });

  it("survives circular and very deep structures", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(redact(cyclic)).toEqual({ a: 1, self: "[circular]" });

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
  });
});

describe("createLogger", () => {
  it("writes one redacted JSON line per call at the matching console level", () => {
    const logs = captureLogs();
    const log = createLogger({ worker: "mm-api" }).child({ request_id: "r-1" });

    log.debug("d");
    log.info("lead_created", { name: "Arjun", lead_id: "L1" });
    log.warn("w");
    log.error("e", { error: new Error("mobile 9876543210") });

    const [debug, info, warn, error] = logs.spies.map((spy) => spy.mock.calls.length);
    expect([debug, info, warn, error]).toEqual([1, 1, 1, 1]);
    const lines = logs.lines();
    const created = lines.find((line) => line.event === "lead_created");
    expect(created).toMatchObject({
      level: "info",
      worker: "mm-api",
      request_id: "r-1",
      name: REDACTED,
      lead_id: "L1",
    });
    expect(typeof created?.time).toBe("string");
    expect(JSON.stringify(lines)).not.toMatch(/Arjun|9876543210/);
  });
});
