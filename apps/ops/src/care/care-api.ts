// The Care inbox's calls (docs/decisions/0129-the-care-inbox.md, 0130-replies-from-the-care-inbox.md,
// 0131-care-people.md): its threads; replying, noting and closing in one; and each client's Care person. Each is made
// with the console's client (../api.ts).

import type { Sent, Success } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export type Conversation = Success<paths["/api/conversations"]["get"]>["conversations"][number];
export type ConversationView = NonNullable<
  NonNullable<paths["/api/conversations"]["get"]["parameters"]["query"]>["view"]
>;
export type ThreadItem = Success<paths["/api/conversations/{id}"]["get"]>["items"][number];
export type ChatThread = Success<paths["/api/conversations/{id}"]["get"]>;
export type CloseReason = Sent<paths["/api/conversations/{id}/close"]["post"]>["reason"];
export type RemedyReason = Sent<paths["/api/clients/{id}/remedies"]["post"]>["reason"];
type RemedyNew = Sent<paths["/api/clients/{id}/remedies"]["post"]>;
export type CareNumbers = Success<paths["/api/care-numbers"]["get"]>;
export type CarePeriod = NonNullable<NonNullable<paths["/api/care-numbers"]["get"]["parameters"]["query"]>["days"]>;
export type CareMember = Success<paths["/api/care-team"]["get"]>["team"][number];

export const careApi = {
  conversations: (view: ConversationView) => client.get("/api/conversations", { query: { view } }),
  conversation: (id: string) => client.get("/api/conversations/{id}", { path: { id } }),
  replyChat: (id: string, text: string) =>
    client.post("/api/conversations/{id}/replies", { path: { id }, body: { text } }),
  noteChat: (id: string, text: string) =>
    client.post("/api/conversations/{id}/notes", { path: { id }, body: { text } }),
  closeChat: (id: string, reason: CloseReason) =>
    client.post("/api/conversations/{id}/close", { path: { id }, body: { reason } }),
  careTeam: () => client.get("/api/care-team"),
  moveCarePerson: (personId: string, email: string) =>
    client.post("/api/clients/{id}/care-person", { path: { id: personId }, body: { email } }),
  setDaysOff: (email: string, weekdays: readonly number[]) =>
    client.post("/api/care-team/days-off", { body: { email, weekdays: [...weekdays] } }),
  addLeave: (email: string, from: string, to: string) =>
    client.post("/api/care-team/leave", { body: { email, from, to } }),
  deleteLeave: (id: string) => client.post("/api/care-team/leave/{id}/delete", { path: { id } }),
  setCareName: (email: string, name: string) => client.post("/api/care-team/name", { body: { email, name } }),
  setOnShift: (on: boolean) => client.post("/api/care-team/shift", { body: { on } }),
  moveAllClients: (from: string, to: string) => client.post("/api/care-team/move-all", { body: { from, to } }),
  quickReplies: () => client.get("/api/quick-replies"),
  giveRemedy: (personId: string, remedy: RemedyNew) =>
    client.post("/api/clients/{id}/remedies", { path: { id: personId }, body: remedy }),
  remedies: () => client.get("/api/remedies"),
  careNumbers: (days: CarePeriod) => client.get("/api/care-numbers", { query: { days } }),
  decideRemedy: (id: string, approve: boolean) =>
    approve
      ? client.post("/api/remedies/{id}/approve", { path: { id } })
      : client.post("/api/remedies/{id}/decline", { path: { id } }),
  addQuickReply: (title: string, text: string) => client.post("/api/quick-replies", { body: { title, text } }),
  retireQuickReply: (id: string) => client.post("/api/quick-replies/{id}/retire", { path: { id } }),
  linkChat: (id: string, personId: string) =>
    client.post("/api/conversations/{id}/link", { path: { id }, body: { person_id: personId } }),
  saveStranger: (id: string, name: string) =>
    client.post("/api/conversations/{id}/save", { path: { id }, body: { name } }),
  raiseCityMatter: (id: string, note: string) =>
    client.post("/api/conversations/{id}/city-matter", { path: { id }, body: { note } }),
};
