// Inventory's home on Today (ADR 0227), in the header's city: the items below zero and out across its places, the
// counts to do and the recalls open; beside Needs you, the places that need attention, the worst first. Its sentence
// is what is below zero or out.

import type { ReactNode } from "react";
import type { Stock, Tasks } from "../api.ts";
import { counts } from "../content/counts.ts";
import { quality } from "../content/quality.ts";
import { stockPlaces } from "../content/stock-places.ts";
import { stock as stockWords } from "../content/stock.ts";
import { today as copy } from "../content/today.ts";
import { useHeading } from "../frame/PageHead.tsx";
import { useCity } from "../lib/city.ts";
import { sectionOf } from "../route.ts";
import { placeName, placesNeedingAttention, type PlaceNeeds } from "../stock/index.ts";
import { AsideList, HomeLayout, type AsideRow, type Shown } from "./HomeLayout.tsx";
import { useRead } from "./reads.ts";
import { todayApi } from "./today-api.ts";

const [BELOW, OUT, LOW] = stockWords.attention.columns;

/** The place's worst state, in the words and tone Stock gives it. */
function worstOf(needs: PlaceNeeds): { words: string; tone: "error" | "warning" } {
  if (needs.below > 0) return { words: stockWords.belowZero, tone: "error" };
  if (needs.out > 0) return { words: stockWords.out, tone: "error" };
  return { words: stockWords.low, tone: "warning" };
}

function places(stock: Stock, needing: readonly PlaceNeeds[]): AsideRow[] {
  const page = sectionOf("stock").path;
  return needing.map((needs) => ({
    key: needs.place.id,
    lead: stockPlaces.kinds[needs.place.kind],
    title: placeName(stock, needs.place.id),
    meta: [
      [BELOW, needs.below],
      [OUT, needs.out],
      [LOW, needs.low],
    ]
      .filter(([, count]) => count !== 0)
      .map(([name, count]) => `${String(name)} ${String(count)}`)
      .join(" · "),
    state: worstOf(needs),
    to: page,
  }));
}

/** Stock's places in the header's city, or all of them. */
function inCity(stock: Stock, city: string | null): Stock {
  return city === null ? stock : { ...stock, places: stock.places.filter((place) => place.city === city) };
}

export function InventoryHome({ needs }: { readonly board: Tasks; readonly needs: ReactNode }) {
  const { city } = useCity();
  const read = useRead(todayApi.stock, "GET /api/stock");
  const countTasks = useRead(todayApi.counts, "GET /api/count-tasks");
  const recalls = useRead(todayApi.recalls, "GET /api/recalls");
  const stock = read === null ? null : inCity(read, city);
  const needing = stock === null ? null : placesNeedingAttention(stock);
  const sum = (field: "below" | "out") => (needing ?? []).reduce((total, place) => total + place[field], 0);
  const placesWith = (field: "below" | "out") =>
    copy.notes.places((needing ?? []).filter((place) => place[field] > 0).length);
  useHeading(needing === null ? undefined : copy.greeting.inventory(sum("below"), sum("out")));
  const figures: Shown[] = [
    needing === null
      ? null
      : { label: BELOW, value: sum("below"), tone: "warning", note: placesWith("below"), page: "stock" },
    needing === null
      ? null
      : { label: OUT, value: sum("out"), tone: "warning", note: placesWith("out"), page: "stock" },
    countTasks === null
      ? null
      : {
          label: counts.states.open,
          value: countTasks.tasks.filter((task) => task.state === "open").length,
          tone: "attention",
          page: "counts",
        },
    recalls === null
      ? null
      : {
          label: quality.recalls,
          value: recalls.recalls.filter((recall) => recall.closed_at === null).length,
          tone: "warning",
          page: "quality",
        },
  ];
  return (
    <HomeLayout
      figures={figures}
      needs={needs}
      aside={
        <AsideList
          page="stock"
          id="today-places"
          title={stockWords.attention.title}
          rows={stock === null || needing === null ? null : places(stock, needing)}
          none={copy.noPlaces}
        />
      }
    />
  );
}
