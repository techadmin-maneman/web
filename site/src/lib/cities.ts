// The cities the site says it comes to, as GET /api/served-cities answers them: each with a pincode ops serve. The
// mm-site Worker writes them into each sentence that names them (a data-cities element), over the one the page was
// built with, which names none.

export interface ServedCities {
  readonly cities: readonly string[];
}

export function isServedCities(value: unknown): value is ServedCities {
  if (typeof value !== "object" || value === null) return false;
  const { cities } = value as Record<string, unknown>;
  return Array.isArray(cities) && cities.every((city) => typeof city === "string" && city !== "");
}

/** "Gurgaon", "Gurgaon and Mumbai", "Gurgaon, Noida and Mumbai". */
export function citiesWords(cities: readonly string[]): string {
  if (cities.length <= 1) return cities.join("");
  return `${cities.slice(0, -1).join(", ")} and ${cities.at(-1) ?? ""}`;
}

/** A sentence with its {cities} named. */
export const namingCities = (sentence: string, cities: readonly string[]): string =>
  sentence.replace("{cities}", citiesWords(cities));
