// Above On hand, the redesign's figures alone (docs/decisions/0308-the-inventory-screens-to-the-22-november-redesign.md):
// the items to reorder where the table looks, the kits short for their technicians' visits already allotted, and,
// for those who may read unit costs, the stock's value at cost.

import { StatTile, StatTiles } from "@maneman/ui/StatTile";
import type { Loaded } from "@maneman/ui/useLoad";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import type { Stock, StockDemand } from "../api.ts";
import { stock as copy } from "../content/stock.ts";
import { itemsApi } from "../items/index.ts";
import { useAccess } from "../lib/access.ts";
import type { Showing } from "./OnHand.tsx";
import { stateOf } from "./stock-state.tsx";

/** The items short where the table looks: one place's, or, across every place or a total, any place's. */
function toReorder(stock: Stock, showing: Showing): number {
  const places = showing.by === "place" && showing.place !== null ? [showing.place] : stock.places.map((p) => p.id);
  return stock.consumables.filter((each) => places.some((place) => stateOf(stock, each, place) !== null)).length;
}

/** What every place within reach holds, at each item's unit cost, from the items' own read. */
function StockValue({ stock }: { stock: Stock }) {
  const [loaded] = useLoad(itemsApi.consumables);
  const value =
    loaded.state === "loaded"
      ? stock.holdings.reduce((sum, holding) => {
          const cost = loaded.value.consumables.find((each) => each.code === holding.consumable_code)?.unit_cost ?? 0;
          return sum + Math.max(holding.quantity, 0) * cost;
        }, 0)
      : null;
  if (loaded.state === "failed") {
    return <StatTile label={copy.figures.value} value={copy.figures.noValue} note={copy.figures.unread} />;
  }
  return (
    <StatTile label={copy.figures.value} value={value === null ? null : rupees(value)} note={copy.figures.atCost} />
  );
}

export function StockFigures(props: { stock: Stock; showing: Showing; demand: Loaded<StockDemand> }) {
  const { stock, showing, demand } = props;
  const mayCost = useAccess().mayCall("GET /api/consumables");
  const reorder = toReorder(stock, showing);
  const kits =
    demand.state === "loaded"
      ? [...new Map(demand.value.kits_short.map((kit) => [kit.technician_id, kit.technician])).values()]
      : null;
  return (
    <StatTiles>
      <StatTile label={copy.figures.reorder} value={reorder} tone={reorder > 0 ? "warning" : "plain"} note="" />
      <StatTile
        label={copy.figures.kitsShort}
        value={kits?.length ?? null}
        tone={kits !== null && kits.length > 0 ? "warning" : "plain"}
        note={kits === null || kits.length === 0 ? "" : kits.join(", ")}
      />
      {mayCost && <StockValue stock={stock} />}
    </StatTiles>
  );
}
