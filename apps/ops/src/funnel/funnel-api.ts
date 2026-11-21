// The Funnel page's call, made with the console's client (../api.ts): the acquisition figures for a week or a month.

import type { Success } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

type Query = NonNullable<paths["/api/growth/acquisition"]["get"]["parameters"]["query"]>;

export type Acquisition = Success<paths["/api/growth/acquisition"]["get"]>;
export type Period = NonNullable<Query["period"]>;
export type ChannelBy = NonNullable<Query["by"]>;
export type ChannelCode = Acquisition["rows"][number]["channel"];

export const funnelApi = {
  acquisition: (query: { period: Period; starting: string; by: ChannelBy; channel: ChannelCode | null }) =>
    client.get("/api/growth/acquisition", {
      query: {
        period: query.period,
        starting: query.starting,
        by: query.by,
        ...(query.channel === null ? {} : { channel: query.channel }),
      },
    }),
};
