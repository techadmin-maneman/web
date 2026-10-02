// Who is signed in, and which calls go ahead for them. The API keeps the rules and names those calls; the console
// only leaves out the sections that would be refused. Asked once per load of the console.

import { useLoad } from "@maneman/ui/useLoad";
import { useMemo } from "react";
import { api, type Answer, type Whoami } from "../api.ts";
import type { MayCall } from "../route.ts";

let asked: Promise<Answer<Whoami>> | null = null;
let answered: Whoami | null = null;

/** The one answer for this load of the console; a failed one is asked again on the next page. */
export function whoami(): Promise<Answer<Whoami>> {
  asked ??= api.whoami().then((answer) => {
    if (answer.ok) answered = answer.body;
    else asked = null;
    return answer;
  });
  return asked;
}

export function useMayCall(): MayCall {
  const [loaded] = useLoad(whoami);
  // The answer already in hand, so a new page's navigation does not show every section while it is asked again.
  const staff = loaded.state === "loaded" ? loaded.value.staff : answered?.staff;
  return useMemo(() => (staff === undefined ? null : new Set(staff.may_call)), [staff]);
}
