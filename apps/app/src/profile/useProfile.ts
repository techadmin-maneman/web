// The profile's own answer (/api/profile), read again every five minutes while a page of the profile is open and as
// soon as it comes back into view. The profile's list and each of its pages read it.

import { useLiveLoad } from "@maneman/ui/useLoad";
import { api } from "../api.ts";

/** How often the profile is read again while it is open. */
const PROFILE_FRESH_MS = 5 * 60_000;

export const useProfile = () => useLiveLoad(api.profile, PROFILE_FRESH_MS);
