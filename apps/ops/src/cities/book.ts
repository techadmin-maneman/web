// What Admin › Cities reads, as the API answers it.

import type { paths } from "../api-schema.ts";

export type CitiesBook = paths["/api/cities"]["get"]["responses"][200]["content"]["application/json"];
export type City = CitiesBook["cities"][number];
export type CityPrice = CitiesBook["prices"][number];
export type CityRuleName = CitiesBook["rule_names"][number];
