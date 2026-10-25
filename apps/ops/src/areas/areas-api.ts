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
};
