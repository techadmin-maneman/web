// What the stock tests share (stock*.test.ts): stock as the console reads it.

export interface Stock {
  consumables: { code: string; name: string; retired: boolean }[];
  places: {
    id: string;
    kind: string;
    name: string;
    parent_id: string | null;
    zone: string | null;
    city: string | null;
    active: boolean;
  }[];
  holdings: {
    consumable_code: string;
    place_id: string;
    quantity: number;
    low: boolean;
    counted_at: string | null;
  }[];
  movements: { consumable_code: string; place_id: string; quantity: number; reason: string; by: string }[];
}
