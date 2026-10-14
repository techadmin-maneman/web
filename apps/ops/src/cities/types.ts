// What Admin › Cities reads, as the API answers it.

import type { paths } from "../api-schema.ts";

export type Cities = paths["/api/cities"]["get"]["responses"][200]["content"]["application/json"];
export type City = Cities["cities"][number];
export type CityPrice = Cities["prices"][number];
export type CityRuleName = Cities["rule_names"][number];
