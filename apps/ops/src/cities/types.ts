// What Admin › Cities reads, as the API answers it.

import type { Success } from "@maneman/web-kit/api";
import type { paths } from "../api-schema.ts";

export type Cities = Success<paths["/api/cities"]["get"]>;
export type City = Cities["cities"][number];
export type CityPrice = Cities["prices"][number];
export type CityRuleName = Cities["rule_names"][number];
