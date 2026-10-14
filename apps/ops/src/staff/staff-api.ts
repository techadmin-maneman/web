// Staff's calls to mm-api: the Staff list, a person saved or deleted, whether the list is enforced, and the service
// tokens. Each is the console's client's (../api.ts), one function a route, so a call is found, and changed, in one
// place.

import { client, type StaffSave, type StaffTokenAdd } from "../api.ts";

export const staffApi = {
  /** The Staff list, narrowed to the places the caller may see. */
  staff: () => client.get("/api/staff"),
  /** A person added, or their grants and whether they are let in replaced whole. */
  saveStaff: (person: StaffSave) => client.post("/api/staff", { body: person }),
  deleteStaff: (email: string) => client.post("/api/staff/delete", { body: { email } }),
  setEnforcement: (on: boolean) => client.post("/api/staff/enforcement", { body: { on } }),
  addServiceToken: (token: StaffTokenAdd) => client.post("/api/staff/service-tokens", { body: token }),
  removeServiceToken: (clientId: string) =>
    client.post("/api/staff/service-tokens/remove", { body: { client_id: clientId } }),
};
