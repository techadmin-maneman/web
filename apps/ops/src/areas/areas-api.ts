// Areas' calls to mm-api: who waits in each pincode, a launch, the service area, and a pincode added. Each is the
// console's client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import { client, type AreaChange, type NewPincode, type PincodesFromDirectory } from "../api.ts";

export const areasApi = {
  waitlist: () => client.get("/api/waitlist"),
  /** Without confirm, what a launch would send; with it, the launch itself, from the day given or today. */
  launch: (pincode: string, confirm: boolean, launchOn: string | null = null) =>
    client.post("/api/pincodes/{pin}/launch", {
      path: { pin: pincode },
      body: { confirm, ...(launchOn === null ? {} : { launch_on: launchOn }) },
    }),
  /** Every pincode, with how many wait there and how many serving it would tell, and our cities. */
  serviceArea: () => client.get("/api/service-area"),
  /**
   * Only the pincodes named change. The route refuses a change that would leave
   * none served, or serve one from a day to come, and launches each pincode it
   * begins serving: `alerted` counts the WhatsApps that queues.
   */
  setServiceArea: (changes: readonly AreaChange[]) =>
    client.post("/api/service-area", { body: { changes: [...changes] } }),
  /** A pincode the service area does not hold, added unserved in one of our cities. */
  addPincode: (pincode: NewPincode) => client.post("/api/pincodes", { body: pincode }),
  /** India Post's states, a state's districts, and the pincodes of those chosen, for opening a city. */
  states: () => client.get("/api/pincode-directory/states"),
  districts: (state: string) => client.get("/api/pincode-directory/districts", { query: { state } }),
  directory: (state: string, districts: readonly string[]) =>
    client.get("/api/pincode-directory/pincodes", { query: { state, district: [...districts] } }),
  /** The pincodes ticked, added unserved in one of our cities; any held already are named back. */
  addFromDirectory: (add: PincodesFromDirectory) => client.post("/api/pincodes/from-directory", { body: add }),
  /** Every launch, those scheduled first; one scheduled for a later day; one cancelled (ADR 0221). */
  launches: () => client.get("/api/pincode-launches"),
  schedule: (city: string, pincodes: readonly string[], goLiveOn: string) =>
    client.post("/api/pincode-launches", { body: { city, pincodes: [...pincodes], go_live_on: goLiveOn } }),
  cancelLaunch: (id: string) => client.post("/api/pincode-launches/{id}/cancel", { path: { id } }),
  /** What a city needs before these pincodes are served there. */
  readiness: (city: string, pincodes: readonly string[]) =>
    client.get("/api/pincode-launches/readiness", { query: { city, pincode: [...pincodes] } }),
  /** Served pincodes paused until a later day, or the pause taken off with null. */
  pause: (pincodes: readonly string[], until: string | null) =>
    client.post("/api/service-area/pause", { body: { pincodes: [...pincodes], until } }),
  /** The visits booked ahead at these pincodes, which stopping them leaves in place. */
  stopImpact: (pincodes: readonly string[]) =>
    client.get("/api/service-area/stop-impact", { query: { pincode: [...pincodes] } }),
};
