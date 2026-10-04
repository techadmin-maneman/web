import { describe, expect, it } from "vitest";
import catalog from "../../data/ailabtools-catalog.json";
import { isKnownTemplate, RESULT_TEMPLATE, renderMessage } from "../../src/config/message-templates.ts";
import { leadNotice } from "../../src/domain/lead-notice.ts";
import { PRESETS, findPreset } from "../../src/config/presets.ts";
import { MAX_UPLOAD_BYTES } from "../../src/config/tryon.ts";
import { checkPhoto } from "../../src/domain/photo.ts";
import { chooseRender } from "../../src/domain/render-choice.ts";
import { inspectImage } from "../../src/lib/image-bytes.ts";
import { signToken, verifyToken } from "../../src/lib/signed-token.ts";
import { NOW } from "./helpers.ts";
import { syntheticJpeg, syntheticPng } from "./tryon-fixtures.ts";

describe("presets", () => {
  it("are the design's six looks, each a style in the AILabTools male catalog", () => {
    const maleStyles = new Set(catalog.styles.male.map((style) => style.id));
    expect(PRESETS).toHaveLength(6);
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(6);
    for (const preset of PRESETS) expect(maleStyles, preset.id).toContain(preset.hairStyle);
  });

  it("default to Pro, which keeps the face (API notes, 7.7)", () => {
    const endpoints: readonly string[] = PRESETS.map((preset) => preset.endpoint);
    expect(new Set(endpoints)).toEqual(new Set(["pro"]));
    expect(findPreset("full-natural-short")?.hairStyle).toBe("Natural_Side-Part");
    expect(findPreset("nope")).toBeUndefined();
  });
});

describe("colour routing", () => {
  const preset = PRESETS[0];

  it("sends a detected colour as it is, to the preset's endpoint", () => {
    expect(chooseRender("crown", preset, "grey", "premium_original")).toMatchObject({
      endpoint: "pro",
      providerColor: "grey",
      colorRoute: "as_detected",
    });
  });

  it("routes an unknown colour by UNKNOWN_COLOR_ROUTE", () => {
    expect(chooseRender("crown", preset, "unknown", "premium_original")).toMatchObject({
      endpoint: "premium",
      providerColor: "original",
      colorRoute: "premium_original",
    });
    expect(chooseRender("crown", preset, "unknown", "pro_black")).toMatchObject({
      endpoint: "pro",
      providerColor: "black",
      colorRoute: "pro_black",
    });
  });
});

describe("inspectImage", () => {
  it("reads a PNG's and a JPEG's size from their headers", () => {
    expect(inspectImage(syntheticPng(640, 480))).toEqual({ type: "image/png", width: 640, height: 480 });
    expect(inspectImage(syntheticJpeg(800, 1200))).toEqual({ type: "image/jpeg", width: 800, height: 1200 });
  });

  it("finds the JPEG frame header after a comment segment", () => {
    expect(inspectImage(syntheticJpeg(300, 400, "mm-stub:stall"))).toMatchObject({ width: 300, height: 400 });
  });

  it("steps over JPEG fill bytes and markers that carry no length", () => {
    const plain = syntheticJpeg(640, 360);
    // SOI, then a fill byte (FF FF) and a restart marker (FF D0) before the rest of the file.
    const padded = Uint8Array.from([0xff, 0xd8, 0xff, 0xff, 0xd0, ...plain.subarray(2)]);
    expect(inspectImage(padded)).toMatchObject({ width: 640, height: 360 });
    // Image data (SOS) before any frame header: the size cannot be known.
    expect(inspectImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toMatchObject({ width: null });
  });

  it("refuses anything that is not a JPEG or PNG, and reports a damaged header as an unknown size", () => {
    expect(inspectImage(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(inspectImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toEqual({
      type: "image/jpeg",
      width: null,
      height: null,
    });
    expect(inspectImage(syntheticPng(10, 10).subarray(0, 20))).toMatchObject({ width: null });
  });
});

describe("checkPhoto", () => {
  it.each([
    [syntheticJpeg(200, 200), null],
    [syntheticPng(4090, 3000), null],
    [syntheticJpeg(199, 400), "photo is 199x400 px"],
    [syntheticPng(4091, 400), "photo is 4091x400 px"],
    [new TextEncoder().encode("not an image"), "photo is not a JPEG or PNG"],
    [new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "photo size unreadable"],
  ])("checks size and type (%#)", (bytes, problem) => {
    const result = checkPhoto(bytes);
    expect(result.ok ? null : result.problem).toBe(problem);
  });

  it("refuses anything over 5 MB", () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(syntheticJpeg(1000, 1000));
    expect(checkPhoto(big)).toEqual({ ok: false, problem: `photo is ${String(MAX_UPLOAD_BYTES + 1)} bytes` });
  });
});

describe("signed tokens", () => {
  const secret = "a-signing-key-of-at-least-thirty-two-characters";
  const inFiveMinutes = new Date(NOW.getTime() + 5 * 60_000);

  it("round-trips a subject until it expires", async () => {
    const token = await signToken(secret, "result", "results/job.png", inFiveMinutes);
    expect(await verifyToken(secret, "result", token, NOW)).toBe("results/job.png");
    expect(await verifyToken(secret, "result", token, new Date(inFiveMinutes.getTime() + 1000))).toBeNull();
  });

  it("refuses another purpose, another key, a changed subject or a malformed token", async () => {
    const token = await signToken(secret, "upload", "job-1", inFiveMinutes);
    expect(await verifyToken(secret, "result", token, NOW)).toBeNull();
    expect(await verifyToken(`${secret}x`, "upload", token, NOW)).toBeNull();
    const [, expires, signature] = token.split(".");
    const forged = `${btoa("job-2").replace(/=+$/, "")}.${expires ?? ""}.${signature ?? ""}`;
    expect(await verifyToken(secret, "upload", forged, NOW)).toBeNull();
    for (const bad of ["", "a.b", "a.b.c.d", "!!.1.x", `${token}x`]) {
      expect(await verifyToken(secret, "upload", bad, NOW)).toBeNull();
    }
  });
});

describe("message templates", () => {
  it("fills params in order, and refuses a missing param or an unknown template", () => {
    expect(renderMessage("tryon_result_v1", ["Arjun"])).toMatch(/^Hello Arjun, here is your Mane Man try-on\./);
    expect(renderMessage("tryon_result_v1", [])).toBeNull();
    expect(renderMessage("nope", ["Arjun"])).toBeNull();
  });

  it("sends the try-on result with a template that exists", () => {
    expect(isKnownTemplate(RESULT_TEMPLATE)).toBe(true);
  });
});

describe("lead notices", () => {
  const lead = {
    lead_id: "0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a01",
    city: "Gurgaon",
    first_choice_window: "weekday_am" as const,
    proposed_visit_date: "2026-09-23",
    contactable: 1,
  };

  it("names the city, window and proposed day of a booking, and never the person", () => {
    expect(leadNotice({ ...lead, source: "form" })).toBe(
      "New booking: Gurgaon, weekday morning, proposed Wed 23 Sep. Lead 0b9f1a52.",
    );
    expect(leadNotice({ ...lead, source: "form", proposed_visit_date: null })).toBe(
      "New booking: Gurgaon, weekday morning. Lead 0b9f1a52.",
    );
  });

  it("names a waitlist's city, and says whether a try-on lead may be chased", () => {
    expect(leadNotice({ ...lead, source: "waitlist", city: "Mumbai" })).toBe(
      "New waitlist sign-up: Mumbai. Lead 0b9f1a52.",
    );
    expect(leadNotice({ ...lead, source: "tryon", city: null, contactable: 0 })).toBe(
      "New try-on lead: WhatsApp copy only, not to be chased. Lead 0b9f1a52.",
    );
    expect(leadNotice({ ...lead, source: "tryon", city: null })).toBe(
      "New try-on lead, from someone who has booked before. Lead 0b9f1a52.",
    );
  });
});
