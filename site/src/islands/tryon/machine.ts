// The try-on's screens and what moves between them: one function of the state
// and what just happened, with no fetching and no timers, so a test can walk it
// (test/node/site/site-tryon-machine.test.ts). TryOn.tsx sends it events and does
// the work around them: the upload, the gate, the render and its watch.
//
// The look goes to WhatsApp only, never to the site
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md): the gate follows
// the looks, and the sent screen the gate.

import { tryOn } from "../../content/site.ts";
import { ERROR_KINDS, type ErrorKind } from "../../lib/tryon-errors.ts";
import { isOneOf } from "../../../../src/lib/one-of.ts";

const SCREENS = ["upload", "consent", "stage", "looks", "gate", "sent", "error"] as const;
export type Screen = (typeof SCREENS)[number];

export interface TryOnState {
  readonly screen: Screen;
  /** Opened with ?state=, outside production: stand-ins and no API calls. */
  readonly demo: boolean;
  /** The chosen photograph, shown from memory. */
  readonly photo: string | null;
  readonly consent: boolean;
  /** Indexes into stageOptions and looks; no look is -1. */
  readonly stage: number;
  readonly look: number;
  /** The gate's fields, kept when the visitor goes back and returns. */
  readonly name: string;
  readonly mobile: string;
  readonly errorKind: ErrorKind;
  /** On the sent screen: a visitor back after their look, whose number the page does not know. */
  readonly returning: boolean;
}

export const START: TryOnState = {
  screen: "upload",
  demo: false,
  photo: null,
  consent: false,
  stage: 0,
  look: -1,
  name: "",
  mobile: "",
  errorKind: "photo",
  returning: false,
};

export type TryOnEvent =
  | { readonly type: "preview"; readonly screen: Screen; readonly kind: string | null }
  | { readonly type: "photoChosen"; readonly photo: string }
  | { readonly type: "consentTicked"; readonly consent: boolean }
  | { readonly type: "agreed" }
  | { readonly type: "stageChosen"; readonly stage: number }
  | { readonly type: "stageDone" }
  | { readonly type: "lookChosen"; readonly look: number }
  | { readonly type: "lookDone" }
  | { readonly type: "nameTyped"; readonly name: string }
  | { readonly type: "mobileTyped"; readonly mobile: string }
  | { readonly type: "sent" }
  | { readonly type: "alreadySent" }
  | { readonly type: "failed"; readonly kind: ErrorKind }
  | { readonly type: "back" }
  | { readonly type: "again" };

/** A screen's name from the address, if it is one. */
export function screenNamed(name: string | null): Screen | undefined {
  return SCREENS.find((screen) => screen === name);
}

/** v2's back control: upload → home, error → upload, gate → looks, else the previous screen; once sent, home. */
export function backFrom(screen: Screen): Screen | "home" {
  switch (screen) {
    case "upload":
      return "home";
    case "consent":
      return "upload";
    case "stage":
      return "consent";
    case "looks":
      return "stage";
    case "gate":
      return "looks";
    case "sent":
      return "home";
    case "error":
      return "upload";
  }
}

/** The looks screen's button: choose one, then go on to the gate. */
export function lookLabel(look: number): string {
  return look >= 0 ? tryOn.looks.continue : tryOn.looks.choose;
}

/**
 * ?state=<screen> with its stand-ins. ?state=error&kind=<renderFailed|busy|unavailable> opens the other error copy,
 * and ?state=sent&kind=returning a returning visitor's.
 */
function preview(screen: Screen, kind: string | null): TryOnState {
  const opened = { ...START, demo: true, screen };
  if (screen === "gate") return { ...opened, look: 0 };
  if (screen === "error") return { ...opened, errorKind: isOneOf(ERROR_KINDS, kind) ? kind : "photo" };
  if (screen !== "sent") return opened;
  const returning = kind === "returning";
  return { ...opened, look: 0, returning, mobile: returning ? "" : tryOn.gate.mobilePlaceholder };
}

export function step(state: TryOnState, event: TryOnEvent): TryOnState {
  switch (event.type) {
    case "preview":
      return preview(event.screen, event.kind);
    case "photoChosen":
      // The agreement is to this photograph's use, so each new one is asked for afresh.
      return { ...state, screen: "consent", photo: event.photo, consent: false };
    case "consentTicked":
      return { ...state, consent: event.consent };
    case "agreed":
      return state.consent ? { ...state, screen: "stage" } : state;
    case "stageChosen":
      return { ...state, stage: event.stage };
    case "stageDone":
      return { ...state, screen: "looks" };
    case "lookChosen":
      return { ...state, look: event.look };
    case "lookDone":
      return state.look >= 0 ? { ...state, screen: "gate" } : state;
    case "nameTyped":
      return { ...state, name: event.name };
    case "mobileTyped":
      return { ...state, mobile: event.mobile };
    case "sent":
      return { ...state, screen: "sent", returning: false };
    case "alreadySent":
      return { ...state, screen: "sent", returning: true };
    case "failed":
      return { ...state, screen: "error", errorKind: event.kind };
    case "back": {
      const target = backFrom(state.screen);
      return target === "home" ? state : { ...state, screen: target };
    }
    case "again":
      return { ...state, screen: "upload" };
  }
}
