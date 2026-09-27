// The try-on's screens and what moves between them (FEO-27): the machine the
// island runs, walked here without a browser, an API or a timer.

import { describe, expect, it } from "vitest";
import { looks, stageOptions, tryOn } from "../../site/src/content/site.ts";
import {
  backFrom,
  lookLabel,
  screenNamed,
  START,
  step,
  type TryOnEvent,
  type TryOnState,
} from "../../site/src/islands/tryon/machine.ts";

const MOCK_AFTER = "/_astro/after.webp";
const RENDERED = { url: "blob:result", file: null };

function walk(...events: TryOnEvent[]): TryOnState {
  return events.reduce(step, START);
}

const PHOTO: TryOnEvent = { type: "photoChosen", photo: "blob:photo" };

/** Through to Generate with a photograph, the agreement, the first stage and the first look. */
const TO_GENERATE: TryOnEvent[] = [
  PHOTO,
  { type: "consentTicked", consent: true },
  { type: "agreed" },
  { type: "stageDone" },
  { type: "lookChosen", look: 0 },
  { type: "generate" },
];

describe("the try-on's machine", () => {
  it("starts on the upload screen with nothing chosen", () => {
    expect(START).toMatchObject({ screen: "upload", demo: false, photo: null, consent: false, look: -1 });
    expect(START.lookFixed).toBe(false);
  });

  it("walks from a photograph to the gate, the look fixed once Generate is pressed", () => {
    expect(walk(PHOTO).screen).toBe("consent");
    expect(walk(...TO_GENERATE.slice(0, 3)).screen).toBe("stage");
    expect(walk(...TO_GENERATE.slice(0, 4)).screen).toBe("looks");
    const processing = walk(...TO_GENERATE);
    expect(processing).toMatchObject({ screen: "processing", look: 0, lookFixed: true });
    expect(step(processing, { type: "processed" }).screen).toBe("gate");
  });

  it("does not leave the consent screen until the agreement is ticked", () => {
    const consent = walk(PHOTO);
    expect(step(consent, { type: "agreed" }).screen).toBe("consent");
    const ticked = step(consent, { type: "consentTicked", consent: true });
    const unticked = step(ticked, { type: "consentTicked", consent: false });
    expect(step(unticked, { type: "agreed" }).screen).toBe("consent");
  });

  it("does not generate before a look is chosen", () => {
    const looksScreen = walk(...TO_GENERATE.slice(0, 4));
    expect(step(looksScreen, { type: "generate" })).toBe(looksScreen);
  });

  it("ignores a countdown that ends once the visitor has left the processing screen", () => {
    const failed = step(walk(...TO_GENERATE), { type: "failed", kind: "renderFailed" });
    expect(step(failed, { type: "processed" }).screen).toBe("error");
  });

  // FEO-19: the agreement is to one photograph's use.
  it("asks for the agreement afresh, and frees the look, when another photograph is chosen", () => {
    const gate = step(walk(...TO_GENERATE), { type: "processed" });
    const again = step(gate, { type: "photoChosen", photo: "blob:another" });
    expect(again).toMatchObject({ screen: "consent", photo: "blob:another", consent: false, lookFixed: false });
    expect(again.showing).toBeNull();
    expect(again.rendered).toBeNull();
  });

  // CLI-11: Back from the gate shows the look fixed, and Continue returns to the gate without a second render.
  it("goes back from the gate to the looks, where Continue returns to the gate", () => {
    const gate = step(walk(...TO_GENERATE), { type: "processed" });
    const back = step(gate, { type: "back" });
    expect(back).toMatchObject({ screen: "looks", lookFixed: true });
    expect(step(back, { type: "lookChosen", look: 1 }).look).toBe(0);
    expect(step(back, { type: "generate" }).screen).toBe("gate");
    expect(lookLabel(back.look, back.lookFixed)).toBe(tryOn.looks.continue);
  });

  it("names the looks screen's button for where the visitor is", () => {
    expect(lookLabel(-1, false)).toBe(tryOn.looks.choose);
    expect(lookLabel(2, false)).toBe(tryOn.looks.generate);
    expect(lookLabel(2, true)).toBe(tryOn.looks.continue);
  });

  it("goes back as v2 does: to the site from the upload, to the upload from an error", () => {
    expect(backFrom("upload")).toBe("home");
    expect(backFrom("consent")).toBe("upload");
    expect(backFrom("stage")).toBe("consent");
    expect(backFrom("looks")).toBe("stage");
    expect(backFrom("processing")).toBe("looks");
    expect(backFrom("gate")).toBe("looks");
    expect(backFrom("result")).toBe("gate");
    expect(backFrom("error")).toBe("upload");
    expect(step(START, { type: "back" })).toBe(START);
  });

  it("shows a failure's own copy, and Choose another returns to the upload", () => {
    const failed = step(walk(...TO_GENERATE), { type: "failed", kind: "busy" });
    expect(failed).toMatchObject({ screen: "error", errorKind: "busy" });
    expect(step(failed, { type: "again" }).screen).toBe("upload");
  });

  it("opens the result after the gate, and keeps a result already fetched", () => {
    const gate = step(walk(...TO_GENERATE), { type: "processed" });
    const showing = { jobId: "job", claim: null, returning: false };
    const result = step(gate, { type: "shown", showing });
    expect(result).toMatchObject({ screen: "result", showing });
    const rendered = step(result, { type: "rendered", rendered: RENDERED });
    expect(rendered.rendered).toBe(RENDERED);
    const backAndAgain = step(step(rendered, { type: "back" }), { type: "shown", showing });
    expect(backAndAgain.rendered).toBe(RENDERED);
  });

  it("shows a returning visitor the look they had, fixed, with its stage and look found by name", () => {
    const own = { jobId: "own", stage: stageOptions[1]?.id ?? "", preset: looks[3]?.id ?? "" };
    const shown = step(walk(...TO_GENERATE.slice(0, 4)), { type: "ownLook", look: own });
    expect(shown).toMatchObject({ screen: "result", stage: 1, look: 3, lookFixed: true, rendered: null });
    expect(shown.showing).toEqual({ jobId: "own", claim: null, returning: true });
  });

  it("leaves a returning visitor's retired look unnamed rather than misnamed", () => {
    const shown = step(START, { type: "ownLook", look: { jobId: "own", stage: "gone", preset: "gone" } });
    expect(shown).toMatchObject({ stage: 0, look: -1 });
  });

  it("keeps the gate's name and number across screens", () => {
    const gate = step(walk(...TO_GENERATE), { type: "processed" });
    const typed = step(step(gate, { type: "nameTyped", name: "Asha" }), { type: "mobileTyped", mobile: "98100 00000" });
    const returned = step(step(typed, { type: "back" }), { type: "generate" });
    expect(returned).toMatchObject({ screen: "gate", name: "Asha", mobile: "98100 00000" });
  });
});

describe("the try-on's previews (?state=, never in production)", () => {
  const preview = (screen: string, kind: string | null = null) => {
    const found = screenNamed(screen);
    if (found === undefined) throw new Error(`no screen ${screen}`);
    return step(START, { type: "preview", screen: found, kind, mockAfter: MOCK_AFTER });
  };

  it("knows the eight screens by name, and nothing else", () => {
    expect(screenNamed("gate")).toBe("gate");
    expect(screenNamed("home")).toBeUndefined();
    expect(screenNamed(null)).toBeUndefined();
  });

  it("opens a screen with stand-ins", () => {
    expect(preview("consent")).toMatchObject({ screen: "consent", demo: true, look: -1 });
    expect(preview("gate")).toMatchObject({ screen: "gate", demo: true, look: 0 });
  });

  it("opens the result with the stand-in image and the gate's number", () => {
    expect(preview("result")).toMatchObject({
      screen: "result",
      look: 0,
      mobile: tryOn.gate.mobilePlaceholder,
      showing: { jobId: "demo", claim: null, returning: false },
      rendered: { url: MOCK_AFTER, file: null },
    });
  });

  it("opens a returning visitor's result with no number", () => {
    expect(preview("result", "returning")).toMatchObject({ mobile: "", showing: { returning: true } });
  });

  // CLI-28: the after side while the render still runs.
  it("opens the result while the render still runs", () => {
    expect(preview("result", "pending")).toMatchObject({ screen: "result", rendered: null });
  });

  it("opens each error's copy, and the photograph's for a kind it does not know", () => {
    expect(preview("error", "busy").errorKind).toBe("busy");
    expect(preview("error", "lookLimit").errorKind).toBe("lookLimit");
    expect(preview("error", "other").errorKind).toBe("photo");
  });
});
