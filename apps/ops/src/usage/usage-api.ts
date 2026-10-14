// Usage's call to mm-api: what each service used. Each is the console's client's (../api.ts), one function a route, so
// a call is found, and changed, in one place.

import { client } from "../api.ts";

export const usageApi = {
  usage: () => client.get("/api/stock/usage"),
};
