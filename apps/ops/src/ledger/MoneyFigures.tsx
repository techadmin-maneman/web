// Money's four figures above the ledger (./LedgerScreen.tsx), for the header's city: what was collected today, the
// payment links not yet paid and the UPI payments to record, from the Tasks board the navigation reads, and the
// refunds still on their way back.

import { Columns } from "@maneman/ui/Layout";
import { StatTile } from "@maneman/ui/StatTile";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback } from "react";
import type { TaskGroup, Tasks } from "../api.ts";
import { tasks } from "../content.ts";
import { noShows } from "../content/no-shows.ts";
import { today } from "../content/today.ts";
import { useAccess } from "../lib/access.ts";
import { useCity } from "../lib/city.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import { ledgerApi } from "./ledger-api.ts";
import styles from "./ledger.module.css";

const words = noShows.money.figures;

/** How many of a group wait on the board; none while it is unread. */
const countOf = (board: Tasks | null, group: TaskGroup["group"]): number | null =>
  board === null ? null : (board.groups.find((each) => each.group === group)?.count ?? 0);

export function MoneyFigures() {
  const { city } = useCity();
  const read = useCallback(() => ledgerApi.day(todayInIndia(apiNow()), city), [city]);
  const [loaded] = useLoad(read);
  const board = useTaskBoard(useAccess().mayCall("GET /api/tasks"));
  const owed = countOf(board, "payment_owed");
  const upi = countOf(board, "upi_due");
  if (loaded.state !== "loaded") return null;
  return (
    <Columns row className={styles.figures}>
      <StatTile label={words.collected(true)} value={rupees(loaded.value.collected)} />
      {owed !== null && (
        <StatTile label={tasks.groups.payment_owed} value={owed} tone={owed > 0 ? "attention" : "plain"} />
      )}
      {upi !== null && <StatTile label={today.tiles.upi} value={upi} tone={upi > 0 ? "attention" : "plain"} />}
      <StatTile label={words.processing} value={rupees(loaded.value.refunds_processing)} />
    </Columns>
  );
}
