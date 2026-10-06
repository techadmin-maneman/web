// The try-on: the stages, the looks, the consent and the gate, and every screen of /try.

import { LOSS_EXTENTS, type LossExtent } from "../../../../src/config/booking.ts";
import { PRESETS, type PresetId } from "../../../../src/config/presets.ts";
import type { ErrorKind } from "../../lib/tryon-errors.ts";
import type { Notice } from "./notices.ts";

/** The illustrated stage options, shared by the try-on and the booking form. */
export const stageOptions: readonly {
  readonly id: LossExtent;
  readonly title: string;
  readonly sub: string;
  readonly short: string;
  readonly hair: string;
  readonly zone: string;
}[] = [
  {
    id: "crown",
    title: "Thinning at the crown",
    sub: "The parting has widened",
    short: "Crown thinning",
    hair: "M13 28 C20 17 44 17 51 28",
    zone: "M32 33 C41 33 46 38 46 44 C46 50 40 55 32 55 C24 55 18 50 18 44 C18 38 23 33 32 33 Z",
  },
  {
    id: "receding",
    title: "Receding at the front",
    sub: "The corners have gone back",
    short: "Receding front",
    hair: "M11 34 C16 22 24 18 32 18 C40 18 48 22 53 34",
    zone: "M13 30 C18 19 25 25 32 25 C39 25 46 19 51 30",
  },
  {
    id: "advanced",
    title: "Advanced, front and crown",
    sub: "Little left on top",
    short: "Advanced",
    hair: "M10 40 C14 30 22 26 32 26 C42 26 50 30 54 40",
    zone: "M12 34 C18 16 46 16 52 34 C46 28 18 28 12 34 Z",
  },
];
if (stageOptions.map((stage) => stage.id).join() !== LOSS_EXTENTS.join()) {
  throw new Error("stageOptions must list the backend's LOSS_EXTENTS in order");
}

/**
 * Each look's picture for the look picker, by look id: a file in site/src/assets. The picker draws pictures only
 * once all six looks have one, and until then shows each look's words alone.
 */
const LOOK_PICTURES: Partial<Record<PresetId, string>> = {};

/** The six looks: the backend's presets, in its order. The design splits each label at its first " · ". */
export const looks = PRESETS.map((preset) => {
  const [density = preset.label, ...rest] = preset.label.split(" · ");
  const picture = LOOK_PICTURES[preset.id];
  return { id: preset.id, label: preset.label, density, detail: rest.join(" · "), picture };
});

/** Every look's picture, in the looks' order, or null while any look has none. */
export function lookPictures(list: readonly { readonly picture?: string | undefined }[] = looks): string[] | null {
  const pictures = list.flatMap((look) => (look.picture === undefined ? [] : [look.picture]));
  return pictures.length === list.length ? pictures : null;
}

/** The consent screen's words, from the photo notice: its title, its rows and the agreement. */
export function consentCopy(photo: Notice) {
  const [title = "", ...rest] = photo.lines;
  const agreement = rest.at(-1) ?? "";
  const rows = rest.slice(0, -1).map((line) => {
    const [k = "", ...v] = line.split(": ");
    return { k, v: v.join(": ") };
  });
  return { title, rows, agreement };
}

/** The gate's words, from its notice. */
export function gateCopy(gate: Notice) {
  const [caption = "", title = "", body = "", reassurance = ""] = gate.lines;
  return { caption, title, body, reassurance };
}

/**
 * The try-on's screens. The look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), so
 * v2's processing and result screens are gone, the gate asks for the number before the look is made, and the sent
 * and unavailable screens, which v2 does not draw, are ADR 0104's words
 * (docs/open-points.md, item 163).
 */
export const tryOn = {
  back: "Back",
  backToSite: "Back to the site",
  stepLabels: {
    upload: "Step one of four",
    consent: "Before we begin",
    stage: "Step two of four",
    looks: "Step three of four",
    gate: "Step four of four",
    sent: "Sent to WhatsApp",
    error: "Cannot use this photograph",
  },
  upload: {
    title: "One photo, taken straight on.",
    body: "The simulation is only as good as the photo. Three things matter, and none of them need a good camera.",
    guidelines: [
      { n: "1", title: "Face the window", body: "Daylight from the front, nothing bright behind you." },
      { n: "2", title: "Straight on, no tilt", body: "Phone at eye level, arm out, chin level." },
      { n: "3", title: "Nothing on your head", body: "No cap, no hood, hair as it is today." },
    ],
    choose: "Choose a photograph",
    camera: "Use the camera",
    previewCaption: "Your photograph appears here",
    previewAlt: "The photograph you chose",
    oval: "Fill the oval",
  },
  /** With the photo notice's words (consentCopy). */
  consent: {
    continue: "Continue",
    privacy: {
      before: "Read the full ",
      link: "privacy notice",
      after: ".",
    },
  },
  stage: {
    title: "Where are you now?",
    body: "Pick whichever is closest. Your technician measures properly at the visit.",
    continue: "Continue",
  },
  looks: {
    title: "Choose a look.",
    body: "You get one look, so pick the one you'd wear.",
    choose: "Choose one to continue",
    continue: "Continue",
  },
  /** With the gate notice's words (gateCopy). Both fields are needed: the number is where the look goes. */
  gate: {
    frame: "For your WhatsApp only",
    name: "Name",
    namePlaceholder: "Your name",
    nameError: "Tell us what to call you, in letters.",
    mobile: "Mobile",
    mobilePlaceholder: "98100 00000",
    mobileError: "Enter a valid 10-digit mobile number.",
    submit: "Send my look",
    // Not drawn: once the WhatsApp code is on its way, the button confirms it and sends the look.
    confirm: "Confirm and send my look",
    sending: "Sending",
    errors: {
      rateLimited: "This number is out of tries for today. Try again tomorrow.",
      taken: "This look is already on its way to another number.",
      other: "That didn't go through. Try again in a minute.",
      // Not drawn: refusals of the WhatsApp code.
      codes: "That’s too many codes for this number today. Try again tomorrow.",
      turnstile: "We couldn’t confirm you’re a person. Try again.",
      notProved: "Your WhatsApp code has expired. Press Send my look for a new one.",
    },
  },
  /** After the gate: the look is on its way to WhatsApp, and never shown here. */
  sent: {
    frame: "On its way to your WhatsApp",
    title: "Your new look is on its way.",
    /** The number the visitor gave goes between the two. */
    to: { before: "It'll reach WhatsApp on ", after: " within minutes." },
    // Production's RESULT_RETENTION_DAYS, as the privacy notice gives it.
    privacy: "We delete it after 14 days.",
    disclaimer:
      "An illustrative simulation, not a photograph of a result. Your hair system is matched to your own hair colour, density and growth pattern.",
    book: "Book a free consultation",
    home: "Back to the site",
    /** A visitor who has had their look, back again, whose number the page does not know. */
    returning: {
      title: "Your look has already been sent.",
      body: "We sent it to the WhatsApp number you gave. It's one look per person, every 30 days.",
    },
  },
  error: {
    another: "Choose another",
    book: "Book a visit instead",
    /** By ErrorKind (lib/tryon-errors.ts). v2's labels, heading and body are the photograph's. */
    kinds: {
      photo: {
        step: "Cannot use this photograph",
        frame: "Cannot read the photograph",
        title: "We cannot use this photograph.",
        body: "Your face may be turned, your hairline covered, or the light too low. Face a window and shoot straight on.",
      },
      renderFailed: {
        step: "Something went wrong",
        frame: "The simulation failed",
        title: "The simulation did not work this time.",
        body: "The photograph looked fine; the simulation failed on our side. Try again with the same photograph or another, or book a consultation and see it in person.",
      },
      busy: {
        step: "Please try again shortly",
        frame: "The simulation is busy",
        title: "The simulation is busy just now.",
        body: "Try again in a few minutes, or book a consultation and see it in person.",
      },
      /** While WhatsApp cannot send a look, the try-on does not run (ADR 0104). It has no Choose another. */
      unavailable: {
        step: "Not available right now",
        frame: "Paused",
        title: "The try-on is paused.",
        body: "We send every look on WhatsApp, and that isn't switched on yet. Book a free consultation and see the real thing.",
      },
    } satisfies Record<ErrorKind, { step: string; frame: string; title: string; body: string }>,
  },
};

// ---------------------------------------------------------------------------
// The WhatsApp code
// ---------------------------------------------------------------------------

/**
 * The code that proves the number before /book's consultation and fit in one visit, or /try's look, acts on it. Not
 * drawn.
 */
export const numberCode = {
  label: "WhatsApp code",
  /** The number the code went to goes after it. */
  sentTo: "Sent on WhatsApp to +91 ",
  hint: "It confirms the number is yours.",
  incomplete: "Enter the six digits from WhatsApp.",
  wrong: (left: number) =>
    left === 1 ? "That code is not right. One try left." : `That code is not right. ${String(left)} tries left.`,
  expired: "That code has expired. Send a new one.",
  failed: "That didn’t go through. Try again.",
  again: "Send a new code",
  checking: "Checking",
};

// ---------------------------------------------------------------------------
// Booking (/book)
// ---------------------------------------------------------------------------
