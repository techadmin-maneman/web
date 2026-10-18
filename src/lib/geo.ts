// Distances between pins on the map, as the crow flies: close enough to rank technicians by and to estimate a drive
// from, and free, since no call to Google is made.

/** A place on the map, in degrees. */
export interface Pin {
  readonly lat: number;
  readonly lng: number;
}

const EARTH_KM = 6371;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** The great-circle distance between two pins, in km. */
export function kmBetween(a: Pin, b: Pin): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}
