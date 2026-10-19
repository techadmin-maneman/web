// The try-on: the stages, the looks, the consent and the gate, and every screen of /try.

import { CLIENT_WORDS, codeMismatch } from "@maneman/web-kit/client-words";
import { PRESETS, type PresetId } from "@rules/config/presets.ts";
import type { ErrorKind } from "../../lib/tryon-errors.ts";
import type { Notice } from "./notices.ts";

/**
 * Each look's picture for the look picker, by look id: a file in site/src/assets, the reference photograph's 512 px
 * head-and-shoulders crop, which stops above the generator's mark on the full photograph. The picker draws pictures
 * only once all six looks have one, and until then shows each look's words alone.
 */
const LOOK_PICTURES: Partial<Record<PresetId, string>> = {
  "side-part": "look-side-part.jpg",
  "slick-back": "look-slick-back.jpg",
  "textured-crop": "look-textured-crop.jpg",
  "french-crop": "look-french-crop.jpg",
  quiff: "look-quiff.jpg",
  "crew-cut": "look-crew-cut.jpg",
};

/** The six looks: the backend's presets, in its order. The picker splits each label at its first " · ". */
export const looks = PRESETS.map((preset) => {
  const [name = preset.label, ...rest] = preset.label.split(" · ");
  const picture = LOOK_PICTURES[preset.id];
  return { id: preset.id, label: preset.label, name, detail: rest.join(" · "), picture };
});

/** Every look's picture, in the looks' order, or null while any look has none. */
export function lookPictures(list: readonly { readonly picture?: string | undefined }[] = looks): string[] | null {
  const pictures = list.flatMap((look) => (look.picture === undefined ? [] : [look.picture]));
  return pictures.length === list.length ? pictures : null;
}

/** The consent screen's words: the photo notice's parts, its title, its rows and the agreement. */
export function consentCopy(photo: Notice) {
  if (photo.layout === undefined) throw new Error(`the ${photo.version} notice has no parts for the consent screen`);
  return photo.layout;
}

/** The gate's words, from its notice. */
export function gateCopy(gate: Notice) {
  const [caption = "", title = "", body = "", reassurance = ""] = gate.lines;
  return { caption, title, body, reassurance };
}

/**
 * The try-on's screens. The look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), so
 * the gate asks for the number before the look is made, and the sent and unavailable screens are ADR 0104's words.
 */
export const tryOn = {
  back: "Back",
  backToSite: "Back to the site",
  stepLabels: {
    upload: "Step 1 of 3",
    consent: "Before we begin",
    looks: "Step 2 of 3",
    gate: "Step 3 of 3",
    sent: "Sent to WhatsApp",
    error: "Can’t use this photo",
  },
  upload: {
    title: "One photo, taken straight on.",
    body: "The look is only as good as the photo. Three things matter, and none of them need a good camera.",
    guidelines: [
      { n: "1", title: "Face the window", body: "Daylight from the front, nothing bright behind you." },
      { n: "2", title: "Straight on, no tilt", body: "Phone at eye level, arm out, chin level." },
      { n: "3", title: "Nothing on your head", body: "No cap, no hood, hair as it is today." },
    ],
    camera: "Take a photo",
    choose: "Choose a photo",
    /** The camera, the whole screen on a phone, then the photo taken or chosen, to use or take again. */
    capture: {
      title: "Your photo",
      view: "The camera’s view of you",
      hint: "Fit your face in the oval",
      shutter: "Take the photo",
      close: "Close",
      still: "Your photo",
      check: "Face clear and well lit?",
      use: "Use photo",
      retake: "Retake",
      another: "Choose another",
      /** Said over a photo too dark to make a good look from, or one the camera gave blank. */
      dark: "A little dark. Face a window for a better look.",
      blank: "We couldn’t see you. Try again.",
    },
    /** Where the browser will not open the camera here: Take a photo then opens the phone’s own. */
    blocked: "The camera is blocked here. Allow it in your browser’s settings, or choose a photo.",
    previewCaption: "Your photo appears here",
    previewAlt: "The photo you chose",
    oval: "Fill the oval",
  },
  /** With the photo notice's words (consentCopy). */
  consent: {
    continue: "Continue",
    /** Said when Continue is pressed before the box is ticked. */
    tickFirst: "Tick the box to agree first.",
    privacy: {
      before: "Read the full ",
      link: "privacy notice",
      after: ".",
    },
  },
  looks: {
    title: "Choose a look.",
    body: "You get one look, so pick the one you’d wear.",
    choose: "Choose one to continue",
    continue: "Continue",
  },
  /** With the gate notice's words (gateCopy). Both fields are needed: the number is where the look goes. */
  gate: {
    frame: "For your WhatsApp only",
    name: "Name",
    nameError: CLIENT_WORDS.nameError,
    mobile: "Mobile",
    mobileError: "Enter a valid 10-digit mobile number.",
    submit: "Send my look",
    // Once the WhatsApp code is on its way, the button confirms it and sends the look.
    confirm: "Confirm and send my look",
    sending: "Sending…",
    /** Said while the look waits on the photograph's upload. */
    photoOnItsWay: "Your photo is still on its way.",
    errors: {
      rateLimited: "This number is out of tries for today. Try again tomorrow.",
      taken: "This look is already on its way to another number.",
      other: "That didn’t go through. Try again in a minute.",
      // Refusals of the WhatsApp code.
      codes: "That’s too many codes for this number today. Try again tomorrow.",
      turnstile: "We couldn’t confirm you’re a person. Try again.",
      notProved: "Your WhatsApp code has expired. Press Send my look for a new one.",
    },
  },
  /** After the gate: the look is on its way to WhatsApp, and never shown here. */
  sent: {
    frame: "On its way to your WhatsApp",
    title: "Your new look is on its way.",
    /** Once the look is ready, shown here beside the photograph as well as sent. */
    ready: {
      title: "Here’s your new look.",
      photoAlt: "Your photo",
      lookAlt: "Your photo with the look you chose",
    },
    /** The number the visitor gave goes between the two. */
    to: { before: "It’ll reach WhatsApp on ", after: " within minutes." },
    // Production's RESULT_RETENTION_DAYS, as the privacy notice gives it.
    privacy: "We delete it after 14 days.",
    disclaimer:
      "An illustration, not a photo of a result. Your hair system is matched to your own hair colour, density and growth pattern.",
    book: "Book a free consultation",
    home: "Back to the site",
    /** A visitor who has had their look, back again, whose number the page does not know. */
    returning: {
      title: "Your look has already been sent.",
      body: "We sent it to the WhatsApp number you gave. One look every 30 days.",
    },
  },
  error: {
    another: "Choose another",
    book: "Book a consultation instead",
    /** By ErrorKind (lib/tryon-errors.ts). */
    kinds: {
      photo: {
        step: "Can’t use this photo",
        frame: "Can’t read the photo",
        title: "We can’t use this photo.",
        body: "Your face may be turned, your hairline covered, or the light too low. Face a window and shoot straight on.",
      },
      noFace: {
        step: "Can’t see your face",
        frame: "Face not clear",
        title: "We couldn’t see your face clearly.",
        body: "Try a well-lit photo, taken straight on.",
      },
      shoulders: {
        step: "Show your shoulders",
        frame: "Shoulders out of frame",
        title: "We need to see your shoulders.",
        body: "Use a photo that shows your head and shoulders.",
      },
      facing: {
        step: "Face the camera",
        frame: "Face turned away",
        title: "Face the camera straight on.",
        body: "Then take the photo again.",
      },
      onePerson: {
        step: "Just you, please",
        frame: "More than one person",
        title: "Only you in the photo, please.",
        body: "Use a photo with no one else in it.",
      },
      notStyleable: {
        step: "Try another photo",
        frame: "Cannot style this one",
        title: "We couldn’t style this photo.",
        body: "Please try another one.",
      },
      refused: {
        step: "Try another photo",
        frame: "Photo not accepted",
        title: "Please try another photo.",
        body: "We can’t use this one.",
      },
      renderFailed: {
        step: "Something went wrong",
        frame: "The look didn’t work",
        title: "The look didn’t work this time.",
        body: "We couldn’t make your look this time. Try again, or book a free consultation to see it in person.",
      },
      busy: {
        step: "Please try again shortly",
        frame: "The try-on is busy",
        title: "The try-on is busy just now.",
        body: "Try again in a few minutes, or book a consultation and see it in person.",
      },
      /** While WhatsApp cannot send a look, the try-on does not run. It has no Choose another. */
      unavailable: {
        step: "Not available right now",
        frame: "WhatsApp",
        title: "We can’t send to WhatsApp just now.",
        body: "Try again in a few minutes, or book a free consultation and see the real thing.",
      },
      /** While the simulation itself cannot run. It has no Choose another either. */
      paused: {
        step: "Not available right now",
        frame: "Paused",
        title: "Try-on is temporarily unavailable.",
        body: "Book a free consultation and see the real thing.",
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
  incomplete: "Enter the 6 digits from WhatsApp.",
  wrong: codeMismatch,
  expired: "That code has expired. Send a new one.",
  failed: CLIENT_WORDS.failed,
  again: "Send a new code",
  checking: "Checking…",
};

// ---------------------------------------------------------------------------
// Booking (/book)
// ---------------------------------------------------------------------------
