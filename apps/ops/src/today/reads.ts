// How a home on Today reads what it shows: only what the person's calls go ahead on, so a home asks the API nothing it
// would refuse them, and nothing until it is the home shown.

import { useLoad } from "@maneman/ui/useLoad";
import type { Answer } from "../api.ts";
import { useAccess, type OpsCall } from "../lib/access.ts";

/** A read the person may not make is not made: it answers as the API would refuse it. */
function notPermitted<T>(): Promise<Answer<T>> {
  return Promise.resolve({ ok: false, status: 403, code: "not_permitted", fields: [], moved: null, requestId: null });
}

/** What the read answered, once it has; null while it reads, where it failed, and where the call would be refused. */
export function useRead<T>(read: () => Promise<Answer<T>>, call: OpsCall): T | null {
  const access = useAccess();
  const [loaded] = useLoad(access.mayCall(call) ? read : notPermitted<T>);
  return loaded.state === "loaded" ? loaded.value : null;
}
