// Which of Stock's views a person may open (../route.ts, STOCK_VIEWS): Labels and Places by the calls they make, the
// rest with Stock itself. Inventory's tabs and Stock both ask it, so the frame does not load Stock's screen to know.

import type { OpsCall } from "../lib/access.ts";
import type { StockView } from "../route.ts";

export function mayOpenView(view: StockView, mayCall: (call: OpsCall) => boolean): boolean {
  if (view === "labels") return mayCall("GET /api/stock/units");
  if (view === "places") return mayCall("POST /api/stock/places");
  return true;
}
