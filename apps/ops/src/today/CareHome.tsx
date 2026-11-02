// Care's home on Today (ADR 0227): the chats to answer, those past their reply time, the median first reply over the
// last week and the remedies to approve; beside Needs you, the chats waiting on us, the longest waiting first, each
// with when it began waiting.

import { apiNow } from "@maneman/web-kit/clock";
import { indiaClock, indiaDate, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import type { ReactNode } from "react";
import type { Tasks } from "../api.ts";
import type { Conversation } from "../care/index.ts";
import { tasks as taskWords } from "../content.ts";
import { care } from "../content/care.ts";
import { today as copy } from "../content/today.ts";
import { sectionOf } from "../route.ts";
import { AsideList, HomeLayout, type AsideRow, type Shown } from "./HomeLayout.tsx";
import { countOf } from "./homes.ts";
import { useRead } from "./reads.ts";
import { todayApi } from "./today-api.ts";

/** Since when the chat has waited on us; one that has not waited, from its last message. */
const waitedSince = (chat: Conversation): string => chat.waiting_since ?? chat.last_message_at;

/** The time it began waiting, or the day where that was before today. */
function since(instant: string, now: number): string {
  const day = indiaDate(instant);
  return day === todayInIndia(now) ? indiaClock(instant) : shortDate(day);
}

function waiting(chats: readonly Conversation[]): AsideRow[] {
  const now = apiNow();
  const messages = sectionOf("messages").path;
  return [...chats]
    .sort((one, other) => Date.parse(waitedSince(one)) - Date.parse(waitedSince(other)))
    .map((chat) => {
      const overdue = chat.reply_by !== null && Date.parse(chat.reply_by) < now;
      return {
        key: chat.id,
        lead: since(waitedSince(chat), now),
        title: chat.person?.name ?? chat.mobile,
        ...(chat.last_line === null ? {} : { meta: chat.last_line }),
        ...(overdue && chat.reply_by !== null
          ? { state: { words: care.overdue(indiaClock(chat.reply_by)), tone: "error" as const } }
          : {}),
        to: messages,
      };
    });
}

export function CareHome({ board, needs }: { readonly board: Tasks; readonly needs: ReactNode }) {
  const numbers = useRead(todayApi.care, "GET /api/care-numbers");
  const chats = useRead(todayApi.waiting, "GET /api/conversations");
  const median = numbers?.replies.median_minutes ?? null;
  const figures: Shown[] = [
    { label: copy.tiles.chats, value: countOf(board, "unanswered_chat"), tone: "attention", page: "messages" },
    numbers === null
      ? null
      : { label: care.numbers.overdue, value: numbers.backlog.overdue, tone: "warning", page: "messages" },
    numbers === null
      ? null
      : {
          label: copy.care.median,
          value: median === null ? copy.care.none : copy.care.minutes(median),
          page: "care-numbers",
        },
    {
      label: taskWords.groups.remedy_approval,
      value: countOf(board, "remedy_approval"),
      tone: "attention",
      page: "messages",
    },
  ];
  return (
    <HomeLayout
      figures={figures}
      needs={needs}
      aside={
        <AsideList
          page="messages"
          id="today-chats"
          title={care.views.open}
          rows={chats === null ? null : waiting(chats.conversations)}
          none={care.none}
        />
      }
    />
  );
}
