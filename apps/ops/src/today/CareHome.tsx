// Care's home on Today (ADR 0227): the chats to answer, those past their reply time, the median first reply over the
// last week and the remedies to approve; beside Needs you, the chats waiting on us, the longest waiting first, each
// with how long it has waited. Its sentence is how many clients wait on a reply.

import { apiNow } from "@maneman/web-kit/clock";
import { indiaClock, minutesBetween } from "@maneman/web-kit/dates";
import { useCallback, type ReactNode } from "react";
import type { Tasks } from "../api.ts";
import type { CareNumbers, Conversation } from "../care/index.ts";
import { tasks as taskWords } from "../content.ts";
import { care } from "../content/care.ts";
import { today as copy } from "../content/today.ts";
import { useHeading } from "../frame/PageHead.tsx";
import { useCity } from "../lib/city.ts";
import { sectionOf } from "../route.ts";
import { AsideList, HomeLayout, pendingFigure, type AsideRow, type Shown } from "./HomeLayout.tsx";
import { countOf } from "./homes.ts";
import { useReadState, type Read } from "./reads.ts";
import { todayApi } from "./today-api.ts";

/** Since when the chat has waited on us; one that has not waited, from its last message. */
const waitedSince = (chat: Conversation): string => chat.waiting_since ?? chat.last_message_at;

/** How many minutes the longest of the chats has waited on us; undefined where none has. */
function longestWait(chats: readonly Conversation[]): number | undefined {
  const now = new Date(apiNow()).toISOString();
  const waits = chats.map((chat) => minutesBetween(waitedSince(chat), now));
  return waits.length === 0 ? undefined : Math.max(...waits);
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
        lead: copy.waited(minutesBetween(waitedSince(chat), new Date(now).toISOString())),
        title: chat.person?.name ?? chat.mobile,
        ...(chat.last_line === null ? {} : { meta: chat.last_line }),
        ...(overdue && chat.reply_by !== null
          ? { state: { words: care.overdue(indiaClock(chat.reply_by)), tone: "error" as const } }
          : {}),
        to: messages,
      };
    });
}

/** Care's two figures from its numbers: each holding its room while they are read, none where they cannot be. */
function numberFigures(read: Read<CareNumbers>): readonly [Shown, Shown] {
  const numbers = read.value;
  if (numbers === null) {
    if (!read.pending) return [null, null];
    return [pendingFigure(care.numbers.overdue, "messages"), pendingFigure(copy.care.median, "care-numbers", true)];
  }
  const median = numbers.replies.median_minutes;
  return [
    { label: care.numbers.overdue, value: numbers.backlog.overdue, tone: "warning", page: "messages" },
    {
      label: copy.care.median,
      value: median === null ? copy.care.none : copy.care.minutes(median),
      note: copy.notes.lastWeek,
      page: "care-numbers",
    },
  ];
}

/** The line beneath the chats to answer: the longest wait, its room kept while the chats are read. */
function oldestNote(oldest: number | undefined, pending: boolean): string | undefined {
  if (oldest !== undefined) return copy.notes.oldest(oldest);
  return pending ? "" : undefined;
}

export function CareHome({ board, needs }: { readonly board: Tasks; readonly needs: ReactNode }) {
  const { city } = useCity();
  const readNumbers = useCallback(() => todayApi.care(city), [city]);
  const readChats = useCallback(() => todayApi.waiting(city), [city]);
  const [overdue, median] = numberFigures(useReadState(readNumbers, "GET /api/care-numbers"));
  const chatsRead = useReadState(readChats, "GET /api/conversations");
  const chats = chatsRead.value;
  const toAnswer = countOf(board, "unanswered_chat");
  const oldest = chats === null ? undefined : longestWait(chats.conversations);
  useHeading(copy.greeting.care(toAnswer));
  const figures: Shown[] = [
    {
      label: copy.tiles.chats,
      value: toAnswer,
      tone: "attention",
      note: oldestNote(oldest, chatsRead.pending),
      page: "messages",
    },
    overdue,
    median,
    {
      label: taskWords.groups.remedy_approval,
      value: countOf(board, "remedy_approval"),
      tone: "attention",
      page: "tasks",
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
