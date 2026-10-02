// Who is signed in, and which of the console's sections they may open: those whose page's first call goes ahead for
// them (docs/decisions/0109-console-departments-and-access.md). The API keeps the rules and says which calls those
// are; the console only leaves out what would be refused. Asked once per load of the console.

import { useLoad } from "@maneman/ui/useLoad";
import { useMemo } from "react";
import { api, type Answer, type Whoami } from "../api.ts";
import { sectionOf, SECTIONS, type Page } from "../route.ts";

let asked: Promise<Answer<Whoami>> | null = null;

/** The one answer for this load of the console; a failed one is asked again on the next page. */
export function whoami(): Promise<Answer<Whoami>> {
  asked ??= api.whoami().then((answer) => {
    if (!answer.ok) asked = null;
    return answer;
  });
  return asked;
}

/**
 * The calls that go ahead for the person signed in, as "GET /api/tasks"; null until the API has said, or if it
 * could not, when every section is shown and the API still refuses what it must.
 */
export type MayCall = ReadonlySet<string> | null;

export function useMayCall(): MayCall {
  const [loaded] = useLoad(whoami);
  return useMemo(() => (loaded.state === "loaded" ? new Set(loaded.value.staff.may_call) : null), [loaded]);
}

export function mayOpen(mayCall: MayCall, page: Page): boolean {
  return mayCall === null || mayCall.has(sectionOf(page).reads);
}

/** Where the console opens: the first section in the navigation the person may open, which is Tasks for most. */
export function landingPath(mayCall: MayCall): string | null {
  const first = SECTIONS.find((section) => mayOpen(mayCall, section.page));
  return first === undefined ? null : first.path;
}
