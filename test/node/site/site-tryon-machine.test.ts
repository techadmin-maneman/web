// The try-on's screens and what moves between them: the machine the
// island runs, walked here without a browser, an API or a timer. The look goes
// to WhatsApp only (ADR 0104): the gate follows the looks, and the sent screen
// the gate.

import { describe, expect, it } from "vitest";
import { CLIENT_WORDS } from "@maneman/web-kit/client-words";
import { tryOn } from "../../../site/src/content/site.ts";
import {
  backFrom,
  lookLabel,
  screenNamed,
  START,
  step,
  type TryOnEvent,
  type TryOnState,
} from "../../../site/src/islands/tryon/machine.ts";

function walk(...events: TryOnEvent[]): TryOnState {
  return events.reduce(step, START);
}

const PHOTO: TryOnEvent = { type: "photoChosen", photo: "blob:photo" };

/** Through to the gate with a photograph, the agreement and the first look. */
const TO_GATE: TryOnEvent[] = [
  PHOTO,
  { type: "consentTicked", consent: true },
  { type: "agreed" },
  { type: "lookChosen", look: 0 },
  { type: "lookDone" },
];

describe("the try-on’s machine", () => {
  it("starts on the upload screen with nothing chosen", () => {
    expect(START).toMatchObject({ screen: "upload", demo: false, photo: null, consent: false, look: -1 });
    expect(START.returning).toBe(false);
  });

  // ADR 0104: the number is asked for before the look is made, so there is no countdown between the looks and the gate.
  // Where the hair loss is is asked nowhere: the agreement goes straight on to the looks.
  it("walks from a photograph to the gate, straight from the agreement to the looks", () => {
    expect(walk(PHOTO).screen).toBe("consent");
    expect(walk(...TO_GATE.slice(0, 3)).screen).toBe("looks");
    expect(walk(...TO_GATE)).toMatchObject({ screen: "gate", look: 0 });
  });

  it("does not leave the consent screen until the agreement is ticked", () => {
    const consent = walk(PHOTO);
    expect(step(consent, { type: "agreed" }).screen).toBe("consent");
    const ticked = step(consent, { type: "consentTicked", consent: true });
    const unticked = step(ticked, { type: "consentTicked", consent: false });
    expect(step(unticked, { type: "agreed" }).screen).toBe("consent");
  });

  it("does not go on to the gate before a look is chosen", () => {
    const looksScreen = walk(...TO_GATE.slice(0, 3));
    expect(step(looksScreen, { type: "lookDone" })).toBe(looksScreen);
  });

  // The agreement is to one photograph's use.
  it("asks for the agreement afresh when another photograph is chosen", () => {
    const again = step(walk(...TO_GATE), { type: "photoChosen", photo: "blob:another" });
    expect(again).toMatchObject({ screen: "consent", photo: "blob:another", consent: false });
  });

  // Nothing is rendered before the gate, so the look may still change.
  it("goes back from the gate to the looks, where another look may be chosen", () => {
    const back = step(walk(...TO_GATE), { type: "back" });
    expect(back.screen).toBe("looks");
    expect(step(back, { type: "lookChosen", look: 1 }).look).toBe(1);
  });

  it("names the looks screen’s button for where the visitor is", () => {
    expect(lookLabel(-1)).toBe(tryOn.looks.choose);
    expect(lookLabel(2)).toBe(tryOn.looks.continue);
  });

  it("goes back as v2 does: to the site from the upload, to the upload from an error; to the site once sent", () => {
    expect(backFrom("upload")).toBe("home");
    expect(backFrom("consent")).toBe("upload");
    expect(backFrom("looks")).toBe("consent");
    expect(backFrom("gate")).toBe("looks");
    expect(backFrom("sent")).toBe("home");
    expect(backFrom("error")).toBe("upload");
    expect(step(START, { type: "back" })).toBe(START);
  });

  it("shows a failure’s own copy, and Choose another returns to the upload", () => {
    const failed = step(walk(...TO_GATE), { type: "failed", kind: "busy" });
    expect(failed).toMatchObject({ screen: "error", errorKind: "busy" });
    expect(step(failed, { type: "again" }).screen).toBe("upload");
  });

  it("says the look is on its way after the gate, with the number given there", () => {
    const typed = step(step(walk(...TO_GATE), { type: "nameTyped", name: "Asha" }), {
      type: "mobileTyped",
      mobile: "98100 00000",
    });
    expect(step(typed, { type: "sent" })).toMatchObject({ screen: "sent", returning: false, mobile: "98100 00000" });
  });

  it("tells a visitor back after their look that it was sent, from any screen, with the look while it is kept", () => {
    expect(step(START, { type: "alreadySent", look: null })).toMatchObject({ screen: "sent", returning: true });
    expect(step(walk(...TO_GATE.slice(0, 3)), { type: "alreadySent", look: null }).screen).toBe("sent");
    const kept = step(START, { type: "alreadySent", look: "/api/result/signed" });
    expect(kept).toMatchObject({ screen: "sent", returning: true, returnedLook: "/api/result/signed" });
  });

  it("keeps the gate’s name and number across screens", () => {
    const gate = walk(...TO_GATE);
    const typed = step(step(gate, { type: "nameTyped", name: "Asha" }), { type: "mobileTyped", mobile: "98100 00000" });
    const returned = step(step(typed, { type: "back" }), { type: "lookDone" });
    expect(returned).toMatchObject({ screen: "gate", name: "Asha", mobile: "98100 00000" });
  });
});

describe("the try-on’s previews (?state=, never in production)", () => {
  const preview = (screen: string, kind: string | null = null) => {
    const found = screenNamed(screen);
    if (found === undefined) throw new Error(`no screen ${screen}`);
    return step(START, { type: "preview", screen: found, kind });
  };

  it("knows the seven screens by name, and nothing else: no result screen", () => {
    expect(screenNamed("gate")).toBe("gate");
    expect(screenNamed("sent")).toBe("sent");
    expect(screenNamed("result")).toBeUndefined();
    expect(screenNamed("processing")).toBeUndefined();
    expect(screenNamed("home")).toBeUndefined();
    expect(screenNamed(null)).toBeUndefined();
  });

  it("opens a screen with stand-ins", () => {
    expect(preview("consent")).toMatchObject({ screen: "consent", demo: true, look: -1 });
    expect(preview("gate")).toMatchObject({ screen: "gate", demo: true, look: 0 });
  });

  it("opens the sent screen with the gate’s number, or a returning visitor’s without one", () => {
    expect(preview("sent")).toMatchObject({ screen: "sent", returning: false, mobile: CLIENT_WORDS.mobilePlaceholder });
    expect(preview("sent", "returning")).toMatchObject({ screen: "sent", returning: true, mobile: "" });
  });

  it("opens each error’s copy, and the photograph’s for a kind it does not know", () => {
    expect(preview("error", "busy").errorKind).toBe("busy");
    expect(preview("error", "unavailable").errorKind).toBe("unavailable");
    expect(preview("error", "lookLimit").errorKind).toBe("photo");
  });
});
