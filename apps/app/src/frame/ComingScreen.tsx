// A page of the redesign not built yet, so its path opens to its name and the way back rather than to Home. Each goes
// as its screen lands; none ships.

import { Note } from "@maneman/ui/Note";
import { titles } from "../content.ts";
import type { Route } from "../route.ts";
import { Shell } from "./Shell.tsx";

export function ComingScreen({ page }: { readonly page: Route["page"] }) {
  return (
    <Shell header={{ kind: "back", title: titles[page], to: "/", label: titles.home }} tab={null}>
      <Note>{titles[page]}</Note>
    </Shell>
  );
}
