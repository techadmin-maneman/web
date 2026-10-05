// The tests' card composer: every card is the same few bytes, a JPEG's frame header saying 1200 x 630, enough for the
// API to read its size and nothing of anyone. It remembers the photographs it was given, read as text, since the
// tests' photographs are words, never images.

import type { CardComposer } from "../../src/providers/cards.ts";

/** A JPEG's bytes as far as its frame header. */
export function jpegOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  view.setUint16(4, 11); // the frame header's length
  bytes[6] = 8; // bits a sample
  view.setUint16(7, height);
  view.setUint16(9, width);
  bytes.set([0xff, 0xd9], 17);
  return bytes;
}

export interface RecordingCards extends CardComposer {
  readonly composed: { readonly before: string; readonly after: string }[];
}

/** Composes each card as `card`, a 1200 x 630 frame header unless a test gives another. */
export function recordingCards(card: Uint8Array = jpegOf(1200, 630)): RecordingCards {
  const composed: { before: string; after: string }[] = [];
  return {
    composed,
    compose({ before, after }) {
      composed.push({ before: new TextDecoder().decode(before), after: new TextDecoder().decode(after) });
      return Promise.resolve(card);
    },
  };
}
