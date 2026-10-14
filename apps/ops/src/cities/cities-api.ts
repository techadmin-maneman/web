// Cities' calls to mm-api: the cities, each one's own rules and prices, and the GST registrations. Each is the
// console's client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

/** A price's place in the book, as its route names it. */
type PricePath = paths["/api/cities/{name}/prices/{item}/{tier}/{valid_from}"]["delete"]["parameters"]["path"];
/** A rule a city sets for itself. */
type CityRule = paths["/api/cities/{name}/rules/{rule}"]["delete"]["parameters"]["path"]["rule"];

export const citiesApi = {
  addCity: (body: Sent<paths["/api/cities"]["post"]>) => client.post("/api/cities", { body }),
  addGstRegistration: (body: Sent<paths["/api/gst-registrations"]["post"]>) =>
    client.post("/api/gst-registrations", { body }),
  addPrice: (name: string, body: Sent<paths["/api/cities/{name}/prices"]["post"]>) =>
    client.post("/api/cities/{name}/prices", { path: { name }, body }),
  changeCity: (name: string, body: Sent<paths["/api/cities/{name}"]["patch"]>) =>
    client.patch("/api/cities/{name}", { path: { name }, body }),
  cities: () => client.get("/api/cities"),
  removeGstRegistration: (stateCode: string) =>
    client.delete("/api/gst-registrations/{state_code}", { path: { state_code: stateCode } }),
  removePrice: (name: string, item: PricePath["item"], tier: string, validFrom: string) =>
    client.delete("/api/cities/{name}/prices/{item}/{tier}/{valid_from}", {
      path: { name, item, tier, valid_from: validFrom },
    }),
  removeRule: (name: string, rule: CityRule) =>
    client.delete("/api/cities/{name}/rules/{rule}", { path: { name, rule } }),
  setRule: (name: string, rule: CityRule, body: Sent<paths["/api/cities/{name}/rules/{rule}"]["patch"]>) =>
    client.patch("/api/cities/{name}/rules/{rule}", { path: { name, rule }, body }),
};
