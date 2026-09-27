// The try-on's screens and what moves between them: one function of the state
// and what just happened, with no fetching and no timers, so a test can walk it
// (test/node/site-tryon-machine.test.ts). TryOn.tsx sends it events and does
// the work around them: the upload, the render, the gate and the result.

import { looks, stageOptions, tryOn } from "../../content/site.ts";
import type { ClaimResponse } from "../../lib/api.ts";
import type { ErrorKind } from "../../lib/tryon-errors.ts";

export const SCREENS = ["upload", "consent", "stage", "looks", "processing", "gate", "result", "error"] as const;
export type Screen = (typeof SCREENS)[number];
const ERROR_KINDS = Object.keys(tryOn.error.kinds) as ErrorKind[];

/** The look on the result screen: its job, the gate's answer if a number was given, and whether it is a returning visitor's. */
export interface Showing {
  readonly jobId: string;
  readonly claim: ClaimResponse | null;
  readonly returning: boolean;
}

/** The finished render: shown from memory, and the same file for Download and WhatsApp. */
export interface Rendered {
  readonly url: string;
  readonly file: File | null;
}

/** A look this browser has already had: its job, and the stage and look it was made with. */
export interface OwnLook {
  readonly jobId: string;
  readonly stage: string;
  readonly preset: string;
}

export interface TryOnState {
  readonly screen: Screen;
  /** Opened with ?state=, outside production: stand-in images and no API calls. */
  readonly demo: boolean;
  /** The chosen photograph, shown from memory. */
  readonly photo: string | null;
  readonly consent: boolean;
  /** Indexes into stageOptions and looks; no look is -1. */
  readonly stage: number;
  readonly look: number;
  /** Generate has been pressed for this photograph: its look can no longer change (ADR 0022, 24). */
  readonly lookFixed: boolean;
  /** The gate's fields, kept when the visitor goes back and returns. */
  readonly name: string;
  readonly mobile: string;
  readonly errorKind: ErrorKind;
  readonly showing: Showing | null;
  readonly rendered: Rendered | null;
}

export const START: TryOnState = {
  screen: "upload",
  demo: false,
  photo: null,
  consent: false,
  stage: 0,
  look: -1,
  lookFixed: false,
  name: "",
  mobile: "",
  errorKind: "photo",
  showing: null,
  rendered: null,
};

export type TryOnEvent =
  | { readonly type: "preview"; readonly screen: Screen; readonly kind: string | null; readonly mockAfter: string }
  | { readonly type: "photoChosen"; readonly photo: string }
  | { readonly type: "consentTicked"; readonly consent: boolean }
  | { readonly type: "agreed" }
  | { readonly type: "stageChosen"; readonly stage: number }
  | { readonly type: "stageDone" }
  | { readonly type: "lookChosen"; readonly look: number }
  | { readonly type: "generate" }
  | { readonly type: "processed" }
  | { readonly type: "nameTyped"; readonly name: string }
  | { readonly type: "mobileTyped"; readonly mobile: string }
  | { readonly type: "shown"; readonly showing: Showing | null; readonly rendered?: Rendered }
  | { readonly type: "rendered"; readonly rendered: Rendered }
  | { readonly type: "ownLook"; readonly look: OwnLook }
  | { readonly type: "failed"; readonly kind: ErrorKind }
  | { readonly type: "back" }
  | { readonly type: "again" };

/** A screen's name from the address, if it is one. */
export function screenNamed(name: string | null): Screen | undefined {
  return SCREENS.find((screen) => screen === name);
}

/** v2's back control: upload → home, error → upload, result → gate, gate → looks, else the previous screen. */
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
    case "processing":
      return "looks";
    case "gate":
      return "looks";
    case "result":
      return "gate";
    case "error":
      return "upload";
  }
}

/** The looks screen's button: choose one, generate it, or, once it is being made, go on to the gate. */
export function lookLabel(look: number, fixed: boolean): string {
  if (fixed) return tryOn.looks.continue;
  return look >= 0 ? tryOn.looks.generate : tryOn.looks.choose;
}

/**
 * ?state=<screen> with its stand-ins. ?state=error&kind=<busy|renderFailed|lookLimit> opens the other error copy,
 * ?state=result&kind=returning a returning visitor's look, and ?state=result&kind=pending the result still rendering.
 */
function preview(screen: Screen, kind: string | null, mockAfter: string): TryOnState {
  const opened = { ...START, demo: true, screen };
  if (screen === "gate") return { ...opened, look: 0 };
  if (screen === "error") return { ...opened, errorKind: ERROR_KINDS.find((known) => known === kind) ?? "photo" };
  if (screen !== "result") return opened;
  const returning = kind === "returning";
  return {
    ...opened,
    look: 0,
    mobile: returning ? "" : tryOn.gate.mobilePlaceholder,
    showing: { jobId: "demo", claim: null, returning },
    rendered: kind === "pending" ? null : { url: mockAfter, file: null },
  };
}

export function step(state: TryOnState, event: TryOnEvent): TryOnState {
  switch (event.type) {
    case "preview":
      return preview(event.screen, event.kind, event.mockAfter);
    case "photoChosen":
      // The agreement is to this photograph's use, so each new one is asked for afresh.
      return {
        ...state,
        screen: "consent",
        photo: event.photo,
        consent: false,
        lookFixed: false,
        showing: null,
        rendered: null,
      };
    case "consentTicked":
      return { ...state, consent: event.consent };
    case "agreed":
      return state.consent ? { ...state, screen: "stage" } : state;
    case "stageChosen":
      return { ...state, stage: event.stage };
    case "stageDone":
      return { ...state, screen: "looks" };
    case "lookChosen":
      return state.lookFixed ? state : { ...state, look: event.look };
    case "generate":
      if (state.look < 0) return state;
      // Back from the gate returns to the looks with the look fixed, and Continue goes back to the gate.
      if (state.lookFixed) return { ...state, screen: "gate" };
      return { ...state, screen: "processing", lookFixed: true };
    case "processed":
      return state.screen === "processing" ? { ...state, screen: "gate" } : state;
    case "nameTyped":
      return { ...state, name: event.name };
    case "mobileTyped":
      return { ...state, mobile: event.mobile };
    case "shown":
      return { ...state, screen: "result", showing: event.showing, rendered: event.rendered ?? state.rendered };
    case "rendered":
      return { ...state, rendered: event.rendered };
    case "ownLook":
      return {
        ...state,
        screen: "result",
        stage: Math.max(
          0,
          stageOptions.findIndex((option) => option.id === event.look.stage),
        ),
        look: looks.findIndex((option) => option.id === event.look.preset),
        lookFixed: true,
        showing: { jobId: event.look.jobId, claim: null, returning: true },
        rendered: null,
      };
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
