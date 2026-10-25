// The Funnel page's call, made with the console's client (../api.ts).

import type { Success } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export type Funnel = Success<paths["/api/growth/funnel"]["get"]>;
export type FunnelDays = NonNullable<NonNullable<paths["/api/growth/funnel"]["get"]["parameters"]["query"]>["days"]>;

export const funnelApi = {
  funnel: (days: FunnelDays) => client.get("/api/growth/funnel", { query: { days } }),
};
