// The city the whole console is narrowed to, chosen in the header (ADR 0225): every page that lists by city reads it.
// It is kept in this browser with the e-mail of the person who chose it, so it is theirs alone, and is let go where
// that is someone else or the city is no longer served. Null is every city.

import { useLoad } from "@maneman/ui/useLoad";
import { useSyncExternalStore } from "react";
import { whoami } from "./access.ts";

const KEPT = "ops.city";

interface Kept {
  readonly who: string;
  readonly city: string;
}

function keptChoice(): Kept | null {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(KEPT) ?? "null");
    if (typeof kept !== "object" || kept === null) return null;
    const { who, city } = kept as Record<string, unknown>;
    return typeof who === "string" && typeof city === "string" ? { who, city } : null;
  } catch {
    return null;
  }
}

let chosen: Kept | null = keptChoice();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function keep(choice: Kept | null): void {
  chosen = choice;
  try {
    if (choice === null) localStorage.removeItem(KEPT);
    else localStorage.setItem(KEPT, JSON.stringify(choice));
  } catch {
    // Kept for this page alone.
  }
  for (const listener of listeners) listener();
}

export interface CityChoice {
  /** The city chosen; null for every city. */
  readonly city: string | null;
  /** The cities served, in the console's order, once the API has said. */
  readonly cities: readonly string[];
  readonly choose: (city: string | null) => void;
}

/**
 * The city chosen and the way to choose another. Until the API has said who is signed in, the city kept in this
 * browser stands, so a page does not load for every city and then again for one.
 */
export function useCity(): CityChoice {
  const [loaded] = useLoad(whoami);
  const kept = useSyncExternalStore(subscribe, () => chosen);
  const who = loaded.state === "loaded" ? loaded.value.signed_in_as : null;
  const cities = loaded.state === "loaded" ? loaded.value.cities : [];
  const stands = kept !== null && (who === null || (kept.who === who && cities.includes(kept.city)));
  return {
    city: stands ? kept.city : null,
    cities,
    choose: (city) => {
      if (who === null) return;
      keep(city === null ? null : { who, city });
    },
  };
}
