// The dispatch board's calls to mm-api: the week, whether it has changed, a day's routes and its map, where a job would
// land, and a job assigned, moved, proposed to the client or let in wherever the phone is. Each is the console's
// client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import { client, type Landing, type Shown, type BoardQuery, moveBody, setOnly } from "../api.ts";

export const dispatchApi = {
  /** Seven days from `from`, or from today, in one city or every one. No name or number is in the query. */
  board: (asked: BoardQuery) => client.get("/api/dispatch", { query: setOnly({ from: asked.from, city: asked.city }) }),
  /** A number that moves whenever something the board draws changes; one row, where the board is hundreds. */
  boardVersion: () => client.get("/api/dispatch/version"),
  /** A day's routes: each technician's visits in order, and the drive between each two. */
  dispatchDay: (date: string, city: string | null) =>
    client.get("/api/dispatch/day", { query: setOnly({ date, city }) }),
  /** The picture of that day's routes. */
  dayMap: (date: string, city: string | null) =>
    client.request<Blob>("GET", `/api/dispatch/day/map?${new URLSearchParams(setOnly({ date, city })).toString()}`, {
      file: true,
    }),
  room: (appointmentId: string, from: string) =>
    client.get("/api/dispatch/room", { query: { appointment_id: appointmentId, from } }),
  /**
   * A job the tray holds, put on a technician. The server runs the clash check
   * before it writes anything, here and on a move alike (ADR 0034).
   */
  assign: (appointmentId: string, to: Landing, shown: Shown) =>
    client.post("/api/dispatch/assign", { body: moveBody(appointmentId, to, shown) }),
  /** A job already on the board, moved. The client is never charged for it; the answer says how they hear of it. */
  move: (appointmentId: string, to: Landing, shown: Shown, clearingCheckIn = false) =>
    client.post("/api/dispatch/move", {
      body: clearingCheckIn
        ? { ...moveBody(appointmentId, to, shown), clear_check_in: true as const }
        : moveBody(appointmentId, to, shown),
    }),
  /** A client's visit to another day, asked of them rather than moved (ADR 0115): it stays put until they accept. */
  propose: (appointmentId: string, to: Landing, shown: Shown) =>
    client.post("/api/dispatch/propose", { body: moveBody(appointmentId, to, shown) }),
  /** Ops take back what they asked of the client; the visit stays where it is. */
  withdrawProposal: (proposalId: string) =>
    client.post("/api/dispatch/proposals/{id}/withdraw", { path: { id: proposalId } }),
  /** Let the technician check in to the visit wherever their phone puts them, with why. */
  letIn: (id: string, reason: string) => client.post("/api/visits/{id}/let-in", { path: { id }, body: { reason } }),
};
