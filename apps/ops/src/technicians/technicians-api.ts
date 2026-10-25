// Technicians' calls to mm-api: the roster, a technician added, changed, switched off or on or deleted, their work,
// their phones, and their leave. Each is the console's client's (../api.ts), one function a route, so a call is found,
// and changed, in one place.

import { client, type TechnicianChange, type NewTechnician } from "../api.ts";

export const techniciansApi = {
  technicians: () => client.get("/api/technicians"),
  /** Their number signs in to the technician app at once. */
  addTechnician: (technician: NewTechnician) => client.post("/api/technicians", { body: technician }),
  /** Only the fields sent change. */
  changeTechnician: (id: string, change: TechnicianChange) =>
    client.patch("/api/technicians/{id}", { path: { id }, body: change }),
  /** Signed out at once; their visits still to come are given back unassigned, and listed in the answer. */
  switchOff: (id: string) => client.post("/api/technicians/{id}/deactivate", { path: { id } }),
  switchOn: (id: string) => client.post("/api/technicians/{id}/reactivate", { path: { id } }),
  /** Refused, as in_use, once anything records work of theirs. */
  deleteTechnician: (id: string) => client.post("/api/technicians/{id}/delete", { path: { id } }),
  /** What each of them has finished, from an India date to today, or over ops's own period; the roster carries none. */
  technicianWork: (from: string | null) =>
    client.get("/api/technicians/work", { query: from === null ? {} : { from } }),
  /** The phone's ID is the app's own, never a hardware serial, so it can stand in a path. */
  revokeDevice: (id: string, deviceId: string) =>
    client.post("/api/technicians/{id}/devices/{device}/revoke", { path: { id, device: deviceId } }),
  /** After a revoke stopped them signing in. */
  allowSignIn: (id: string) => client.post("/api/technicians/{id}/allow-sign-in", { path: { id } }),
  standingLeave: (id: string) => client.get("/api/technicians/{id}/leave", { path: { id } }),
  /** Both dates inclusive. Those days are then refused to booking and to the dispatch board alike (ADR 0062). */
  recordLeave: (
    id: string,
    leave: { from: string; to: string; note: string | null; times: { from: string; to: string } | null },
  ) =>
    client.post("/api/technicians/{id}/leave", {
      path: { id },
      body: {
        from: leave.from,
        to: leave.to,
        ...(leave.note === null ? {} : { note: leave.note }),
        ...(leave.times === null ? {} : { from_time: leave.times.from, to_time: leave.times.to }),
      },
    }),
  cancelLeave: (id: string, leaveId: string) =>
    client.post("/api/technicians/{id}/leave/{leave}/cancel", { path: { id, leave: leaveId } }),
  /** Each day they work and its hours; none returns them to their city's hours (ADR 0210). */
  setHours: (id: string, days: readonly { weekday: number; starts: string; ends: string }[]) =>
    client.post("/api/technicians/{id}/hours", { path: { id }, body: { days: [...days] } }),
  /** One session token for the whole search, sent again with the place chosen. */
  homeSuggestions: (id: string, q: string, session: string) =>
    client.post("/api/technicians/{id}/home/suggestions", { path: { id }, body: { q, session } }),
  setHome: (id: string, placeId: string, session: string) =>
    client.post("/api/technicians/{id}/home", { path: { id }, body: { place_id: placeId, session_token: session } }),
};
