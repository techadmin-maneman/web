// The stock the Stock page draws (./StockScreen.tsx): read as the page opens, then whatever a movement or a change to
// the places answered, so the page follows without reading it again.

import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { api, type Stock } from "../api.ts";

export function useStock() {
  const [loaded, retry] = useLoad(api.stock);
  const [after, setStock] = useState<Stock | null>(null);
  /** The latest answer: a write's, or the page's own read; null until the read is in. */
  const current = after ?? (loaded.state === "loaded" ? loaded.value : null);
  return { loaded, retry, current, setStock };
}
