// A technician's safety on a visit (docs/decisions/0248-safety.md): how often the phone says where they are, how long a
// position is kept at most, and the map link an SOS gives ops.

/** How often the phone sends where the technician is, from check-in to the close. */
export const POSITION_EVERY_MINUTES = 2;

/** The longest a visit's position is kept, should its close never come: the hourly sweep deletes it then. */
export const POSITION_KEPT_HOURS = 12;

/** A map at the technician's position, for ops in the alert space and on the console. */
export const mapLink = (position: { readonly lat: number; readonly lng: number }): string =>
  `https://www.google.com/maps?q=${String(position.lat)},${String(position.lng)}`;
