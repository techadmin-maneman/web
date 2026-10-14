// What the booking sheet reads before it holds a window (./BookingSheet.tsx): the client's profile, for their address
// and their reminders, and the days of the visit wanted, each answer taking the sheet to its step (./flow.ts).

import { useEffect, useEffectEvent, useRef, useState, type Dispatch } from "react";
import { api, type Address, type BookingWindow, type OfferedService, type Profile, type Wanted } from "../api.ts";
import type { BookingEvent } from "./flow.ts";
import { useDays } from "./useDays.ts";

/** Whether the client has switched on WhatsApp about their visits, the purpose the day-before reminder is sent under. */
const remindersOn = (profile: Profile) =>
  profile.consents.some((consent) => consent.purpose === "whatsapp_visits" && consent.granted);

interface Asking {
  readonly dispatch: Dispatch<BookingEvent>;
  readonly movingId: string | undefined;
  readonly firstDay: string | undefined;
  readonly offeredDate: string | undefined;
  readonly offeredWindow: BookingWindow | null | undefined;
  readonly wanted: Wanted | null;
  readonly setWanted: (wanted: Wanted) => void;
}

export function useSheetData(asking: Asking) {
  const { dispatch, movingId, firstDay, offeredDate, offeredWindow, wanted } = asking;
  /** Whether reminders are on: null when the profile could not say, and the sheet asks. */
  const [reminders, setReminders] = useState<boolean | null>(null);
  // True once the sheet knows it asks for the address before the date, which adds a step to the boards' three.
  const [addressFirst, setAddressFirst] = useState(false);
  // The profile had no address when it was last read, so the address comes before the date.
  const addressMissing = useRef(false);
  // The address the profile had when it was last read.
  const savedAddress = useRef<Address | null>(null);
  const days = useDays({ dispatch, movingId, offeredDate, offeredWindow, addressMissing });
  const { showDays } = days;

  const askForAddress = (refused: boolean) => {
    setAddressFirst(true);
    dispatch({ kind: "addressNeeded", refused });
  };

  /** The API offers nothing at the address saved, which the client changes, or they join the waitlist. */
  const showNotServed = () => {
    dispatch({ kind: "notServed", address: savedAddress.current });
  };

  /**
   * Reads the profile, and the days of the visit wanted once there is one, and goes to the first step still to take:
   * picking the visit, the address, or the date.
   */
  const load = async (visit: Wanted | null) => {
    dispatch({ kind: "asking" });
    const [answer, profile] = await Promise.all([
      visit === null ? null : api.availability(visit, movingId, firstDay),
      api.profile(),
    ]);
    setReminders(profile.ok ? remindersOn(profile.body) : null);
    savedAddress.current = profile.ok ? profile.body.address : null;
    if (answer !== null && !answer.ok) {
      if (answer.code === "not_served") showNotServed();
      else dispatch({ kind: "failed" });
      return;
    }
    addressMissing.current = profile.ok && profile.body.address === null;
    // Known now, so the step that picks the visit counts the address among the steps to come.
    if (addressMissing.current) setAddressFirst(true);
    if (answer === null) dispatch({ kind: "answered", picking: true, addressMissing: addressMissing.current });
    else showDays(answer.body);
  };

  // Read as the sheet opens, and again should what it opened on change; the step's own buttons read it again too.
  const loadNow = useEffectEvent(() => {
    void load(wanted);
  });
  useEffect(() => {
    loadNow();
  }, [movingId, firstDay, offeredDate, offeredWindow]);

  /** The client has picked their visit: its days, the profile already read. */
  const pick = async (service: OfferedService) => {
    const visit = { type: service.type, tier: service.tier };
    asking.setWanted(visit);
    dispatch({ kind: "asking" });
    const answer = await api.availability(visit, movingId, firstDay);
    if (answer.ok) showDays(answer.body);
    else if (answer.code === "not_served") showNotServed();
    else dispatch({ kind: "failed" });
  };

  return { days, reminders, setReminders, addressFirst, askForAddress, showNotServed, load, pick };
}
