// The loading state: the shape of a label and a card while a page's data comes (packages/ui/States.tsx).

import { Loading as SharedLoading } from "@maneman/ui/States";
import { states } from "../content.ts";

export function Loading() {
  return <SharedLoading label={states.loading} />;
}
