// What the stock tests share (stock*.test.ts): stock as the console reads it.

export interface Stock {
  consumables: { code: string; name: string; retired: boolean }[];
  places: { technician_id: string | null; name: string | null; active: boolean }[];
  holdings: {
    consumable_code: string;
    technician_id: string | null;
    quantity: number;
    low: boolean;
    counted_at: string | null;
  }[];
  movements: { consumable_code: string; technician_id: string | null; quantity: number; reason: string; by: string }[];
}
