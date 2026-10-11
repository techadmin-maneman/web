// The Care inbox's calls (docs/decisions/0129-the-care-inbox.md, 0130-replies-from-the-care-inbox.md): its threads,
// and replying, noting and closing in one, made with the console's client (../api.ts).

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

export const careApi = {
  conversations: (view: ConversationView) => client.get("/api/conversations", { query: { view } }),
  conversation: (id: string) => client.get("/api/conversations/{id}", { path: { id } }),
  replyChat: (id: string, text: string) =>
    client.post("/api/conversations/{id}/replies", { path: { id }, body: { text } }),
  noteChat: (id: string, text: string) =>
    client.post("/api/conversations/{id}/notes", { path: { id }, body: { text } }),
  closeChat: (id: string, reason: CloseReason) =>
    client.post("/api/conversations/{id}/close", { path: { id }, body: { reason } }),
};
