// The cities the site says it comes to, as GET /api/served-cities answers them: each with a pincode ops serve, and
// the areas served in each. The mm-site Worker writes them into each sentence that names them (a data-cities
// element), over the one the page was built with, which names none, and lists a city's areas on its own page.

export interface ServedCities {
  readonly cities: readonly string[];
  /** Each city's areas, A to Z; absent from an mm-api that answers only the cities. */
  readonly areas?: Readonly<Record<string, readonly string[]>>;
}

const isNames = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((name) => typeof name === "string" && name !== "");

function isAreas(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.values(value).every(isNames);
}

export function isServedCities(value: unknown): value is ServedCities {
  if (typeof value !== "object" || value === null) return false;
  const { cities, areas } = value as Record<string, unknown>;
  return isNames(cities) && (areas === undefined || isAreas(areas));
}

/** A city's address under /areas/: "gurgaon", "navi-mumbai". */
export const citySlug = (city: string): string =>
  city
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-");

/** "Gurgaon", "Gurgaon and Mumbai", "Gurgaon, Noida and Mumbai". */
export function citiesWords(cities: readonly string[]): string {
  if (cities.length <= 1) return cities.join("");
  return `${cities.slice(0, -1).join(", ")} and ${cities.at(-1) ?? ""}`;
}

/** A sentence with its {cities} named. */
export const namingCities = (sentence: string, cities: readonly string[]): string =>
  sentence.replace("{cities}", citiesWords(cities));
