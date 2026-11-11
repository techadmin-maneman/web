// A technician's safety on a visit (docs/decisions/0248-safety.md): how often the phone says where they are, how long a
// position is kept at most, and the map link an SOS gives ops.

/** How often the phone sends where the technician is, from check-in to the close. */
export const POSITION_EVERY_MINUTES = 2;

/** The longest a visit's position is kept, should its close never come: the hourly sweep deletes it then. */
export const POSITION_KEPT_HOURS = 12;

/** The least time between two pages of one SOS, or of its "I'm safe": raised and said safe over and over pages once. */
export const PAGE_AGAIN_AFTER_MINUTES = 5;

/** A map at the technician's position, to about a metre, for ops on the console's banner. */
export const mapLink = (position: { readonly lat: number; readonly lng: number }): string =>
  `https://www.google.com/maps?q=${position.lat.toFixed(5)},${position.lng.toFixed(5)}`;
