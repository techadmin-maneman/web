// Who is signed in, and what they may do. The API keeps the rules and says which calls go ahead for them; the console
// leaves out the sections and the buttons that would be refused. Asked once per load of the console.

import { useLoad } from "@maneman/ui/useLoad";
import { useMemo } from "react";
import { NATIONAL, type Caller, type Grant, type Place } from "../../../../src/policy/access.ts";
import { meetsNeed, type RouteNeed } from "../../../../src/policy/console-routes.ts";
import { api, type Answer, type StaffGrant, type Whoami } from "../api.ts";
import type { paths } from "../api-schema.ts";
import type { MayCall } from "../route.ts";

/** The choices inside a call that ask more than the call does, as the API asks them. */
export {
  alertNeed,
  markDoneNeed,
  REFUNDING_A_DISPUTE,
  taskNeed,
  WAIVING_A_NO_SHOW,
} from "../../../../src/policy/console-routes.ts";

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

/** The answer in hand, so a new page does not show what it should not while it is asked again. */
function useStaff(): Whoami["staff"] | undefined {
  const [loaded] = useLoad(whoami);
  return loaded.state === "loaded" ? loaded.value.staff : answered?.staff;
}

export function useMayCall(): MayCall {
  const staff = useStaff();
  return useMemo(() => (staff === undefined ? null : new Set(staff.may_call)), [staff]);
}

type Method = "get" | "put" | "post" | "patch" | "delete";

/** A call to the API as its document names it: "POST /api/grievances/{id}/resolve". */
export type OpsCall = {
  [Path in keyof paths]: {
    [Verb in Method]: paths[Path][Verb] extends undefined ? never : `${Uppercase<Verb>} ${Path}`;
  }[Method];
}[keyof paths];

export interface Access {
  /** Whether the call goes ahead for them. */
  readonly mayCall: (call: OpsCall) => boolean;
  /** Whether their grants reach what a choice inside a call asks, as waiving a no-show's charge does. */
  readonly reaches: (need: RouteNeed) => boolean;
}

/** Until the API has said, and while the Staff list is not enforced: the API still refuses what it must. */
const EVERYTHING: Access = { mayCall: () => true, reaches: () => true };

/** Every need is asked nationally or anywhere, where no city's zone is looked up. */
const NO_ZONES: ReadonlyMap<string, string> = new Map();

function placeOf(grant: StaffGrant): Place {
  if (grant.geography === "national" || grant.place === null) return NATIONAL;
  return { geography: grant.geography, name: grant.place };
}

const grantOf = (grant: StaffGrant): Grant => ({
  department: grant.department,
  level: grant.level,
  place: placeOf(grant),
});

/** What whoami's answer lets them do: everything while the Staff list is not enforced, as the API lets it. */
export function accessOf(staff: Whoami["staff"]): Access {
  if (!staff.enforced) return EVERYTHING;
  const open = new Set<string>(staff.may_call);
  const caller: Caller = { kind: "person", active: staff.listed, grants: staff.grants.map(grantOf) };
  return {
    mayCall: (call) => open.has(call),
    reaches: (need) => meetsNeed(caller, need, NO_ZONES),
  };
}

/** What the person signed in may do: the calls the API lets through for them, and what their grants reach. */
export function useAccess(): Access {
  const staff = useStaff();
  return useMemo(() => (staff === undefined ? EVERYTHING : accessOf(staff)), [staff]);
}
