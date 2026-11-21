// The Campaign links page's calls (docs/decisions/0288-attribution-and-conversions.md), made with the console's client
// (../api.ts).

import type { Sent, Success } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export type CampaignLinks = Success<paths["/api/campaign-links"]["get"]>;
export type CampaignLink = CampaignLinks["links"][number];
export type NewCampaignLink = Sent<paths["/api/campaign-links"]["post"]>;

export const campaignLinksApi = {
  list: () => client.get("/api/campaign-links"),
  add: (link: NewCampaignLink) => client.post("/api/campaign-links", { body: link }),
  retire: (id: string) => client.post("/api/campaign-links/{id}/retire", { path: { id } }),
};
