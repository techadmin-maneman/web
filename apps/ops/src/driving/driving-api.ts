// Reports › Driving's call to mm-api (docs/decisions/0294-learned-drive-times.md), made with the console's client
// (../api.ts).

import type { Success } from "@maneman/web-kit/api";
import { client, setOnly } from "../api.ts";
import type { paths } from "../api-schema.ts";

type Asked = NonNullable<paths["/api/reports/driving"]["get"]["parameters"]["query"]>;

export type Driving = Success<paths["/api/reports/driving"]["get"]>;
export type DrivingWeeks = NonNullable<Asked["weeks"]>;
export type DrivingBy = NonNullable<Asked["by"]>;

export const drivingApi = {
  driving: (weeks: DrivingWeeks, by: DrivingBy, city: string | null) =>
    client.get("/api/reports/driving", { query: { weeks, by, ...setOnly({ city }) } }),
};
