// Finance's home on Today (ADR 0227): the money collected today, the UPI payments to record, the charges to decide and
// the payments owed; beside Needs you, today's payments, the latest first.

import type { Success } from "@maneman/web-kit/api";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaClock, todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, type ReactNode } from "react";
import type { Tasks } from "../api.ts";
import type { paths } from "../api-schema.ts";
import { tasks as taskWords, written } from "../content.ts";
import { ledger } from "../content/ledger.ts";
import { today as copy } from "../content/today.ts";
import { clientPath } from "../route.ts";
import { useCollected } from "./CityHome.tsx";
import { AsideList, HomeLayout, type AsideRow, type Shown } from "./HomeLayout.tsx";
import { countOf } from "./homes.ts";
import { useRead } from "./reads.ts";
import { todayApi } from "./today-api.ts";

type Payment = Success<paths["/api/payments/ledger"]["get"]>["payments"][number];

function useTodaysPayments(): readonly Payment[] | null {
  const date = todayInIndia(apiNow());
  const read = useCallback(() => todayApi.payments(date), [date]);
  return useRead(read, "GET /api/payments/ledger")?.payments ?? null;
}

/** The payments taken today, the latest first, each with what it was for and how it was paid. */
function latest(payments: readonly Payment[]): AsideRow[] {
  return payments
    .filter((payment): payment is Payment & { captured_at: string } => payment.captured_at !== null)
    .sort((one, other) => Date.parse(other.captured_at) - Date.parse(one.captured_at))
    .map((payment) => ({
      key: payment.id,
      lead: indiaClock(payment.captured_at),
      title: payment.person?.name ?? payment.reference ?? ledger.noClient,
      meta: [
        ledger.kinds[payment.kind] ?? payment.kind,
        payment.method === null ? null : ledger.methods[payment.method],
      ]
        .filter((part) => part !== null && part !== undefined)
        .join(" · "),
      state: { words: rupees(payment.amount), tone: "done" as const },
      ...(payment.person === null ? {} : { to: clientPath(payment.person.id, "payments") }),
    }));
}

export function FinanceHome({ board, needs }: { readonly board: Tasks; readonly needs: ReactNode }) {
  const collected = useCollected();
  const payments = useTodaysPayments();
  const figures: Shown[] = [
    collected,
    { label: copy.tiles.upi, value: countOf(board, "upi_due"), tone: "attention", page: "tasks" },
    {
      label: copy.tiles.charges,
      value: countOf(board, "no_show_decision") + countOf(board, "no_show_dispute"),
      page: "payments",
    },
    { label: taskWords.groups.payment_owed, value: countOf(board, "payment_owed"), tone: "attention", page: "tasks" },
  ];
  return (
    <HomeLayout
      figures={figures}
      needs={needs}
      aside={
        <AsideList
          page="ledger"
          id="today-payments"
          title={ledger.title}
          rows={payments === null ? null : latest(payments)}
          none={written(copy.noPayments)}
        />
      }
    />
  );
}
