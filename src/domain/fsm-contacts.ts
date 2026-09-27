// A person's contact in FSM: the one the mirror or an earlier booking linked,
// else the one FSM already holds for their number, else a new one. FSM holds
// the city, and the pincode and street of the address the client saved, if
// they have; otherwise the street is confirmed with them. A contact FSM already
// held is given the address as it is linked.

import { createLogger, type Logger } from "../log.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { currentAddress, streetOf, type Address } from "./profile.ts";

/** The state each served city is in, with its GST code, for the contact's place of supply. */
const STATES: Readonly<Record<string, { state: string; code: string }>> = {
  Gurgaon: { state: "Haryana", code: "HR" },
  Faridabad: { state: "Haryana", code: "HR" },
  Delhi: { state: "Delhi", code: "DL" },
  Noida: { state: "Uttar Pradesh", code: "UP" },
  Ghaziabad: { state: "Uttar Pradesh", code: "UP" },
};

/** Where a booking says the person is: the city FSM files them under, and the pincode if the booking had one. */
export interface Place {
  readonly city: string;
  readonly pincode: string | null;
}

/**
 * The person's FSM contact ID, adding the contact if they have none. Its city is the place's if given, else their
 * saved address's, else their latest booking's, else the city of the pincode they were invited at. An invited
 * friend's lead names the city of the pincode they gave; where even that is not one of ours, the invite's pincode
 * is the only city we hold until they save an address.
 *
 * FSM is asked first for a contact with their number, so a retry whose answer was lost, or a contact ops added
 * by hand, is not added twice. Such a contact is given the address we hold as it is linked: one saved before then
 * had no contact to go to (src/queues/fsm-sync.ts). The ID is kept at once.
 */
export async function fsmContactOf(
  db: D1Database,
  fsm: FsmProvider,
  personId: string,
  place?: Place,
  log: Logger = createLogger(),
): Promise<string> {
  const person = await db
    .prepare(
      `SELECT p.name, p.mobile_e164, p.email, p.fsm_contact_id,
              (SELECT l.city FROM leads l WHERE l.person_id = p.id AND l.city IS NOT NULL
               ORDER BY l.created_at DESC LIMIT 1) AS lead_city,
              (SELECT sp.city FROM referral_attributions r
                 JOIN serviceable_pincodes sp ON sp.pincode = r.pincode
               WHERE r.referred_person_id = p.id) AS invited_city
       FROM people p WHERE p.id = ?1`,
    )
    .bind(personId)
    .first<{
      name: string;
      mobile_e164: string;
      email: string | null;
      fsm_contact_id: string | null;
      lead_city: string | null;
      invited_city: string | null;
    }>();
  if (person === null) throw new Error("no such person to add to FSM");
  if (person.fsm_contact_id !== null) return person.fsm_contact_id;

  const found = await existingContact(fsm, person.mobile_e164, log);
  if (found !== null) await giveAddress(db, fsm, found, { personId, mobile: person.mobile_e164, place }, log);
  const contactId = found ?? (await addContact(db, fsm, personId, person, place));
  await db
    .prepare("UPDATE people SET fsm_contact_id = ?1 WHERE id = ?2 AND fsm_contact_id IS NULL")
    .bind(contactId, personId)
    .run();
  return contactId;
}

/** The contact FSM already holds for the number; null if none, or if FSM could not be asked. */
async function existingContact(fsm: FsmProvider, mobile: string, log: Logger): Promise<string | null> {
  try {
    return await fsm.findContact(mobile);
  } catch (error) {
    log.warn("fsm_contact_lookup_failed", { error });
    return null;
  }
}

/**
 * The saved address, where it can be the service address: only where it is in the city the visit is in. The
 * booking's own pincode says so too, whether the client typed the city as Gurgaon or Gurugram.
 */
function inPlace(saved: Address, city: string, place: Place | undefined): Address | null {
  return saved.city === city || saved.pincode === place?.pincode ? saved : null;
}

/**
 * Writes the address we hold over a contact FSM already had for the number. One FSM will not take is logged, and
 * the booking goes on with the contact as FSM had it.
 */
async function giveAddress(
  db: D1Database,
  fsm: FsmProvider,
  contactId: string,
  person: { personId: string; mobile: string; place: Place | undefined },
  log: Logger,
): Promise<void> {
  const saved = await currentAddress(db, person.personId);
  const address = saved === null ? null : inPlace(saved, person.place?.city ?? saved.city, person.place);
  if (address === null) return;
  try {
    await fsm.updateContact(contactId, {
      mobile: person.mobile,
      address: { ...streetOf(address), city: address.city, pincode: address.pincode },
    });
  } catch (error) {
    log.warn("fsm_contact_address_failed", { person_id: person.personId, error });
  }
}

async function addContact(
  db: D1Database,
  fsm: FsmProvider,
  personId: string,
  person: {
    name: string;
    mobile_e164: string;
    email: string | null;
    lead_city: string | null;
    invited_city: string | null;
  },
  place: Place | undefined,
): Promise<string> {
  const saved = await currentAddress(db, personId);
  const city = place?.city ?? saved?.city ?? person.lead_city ?? person.invited_city;
  if (city === null) throw new Error("the person has no city to give FSM");
  const address = saved === null ? null : inPlace(saved, city, place);
  const [first, ...rest] = person.name.trim().split(/\s+/);
  const state = STATES[city];
  return fsm.createContact({
    firstName: rest.length === 0 ? null : (first ?? null),
    lastName: rest.length === 0 ? person.name.trim() : rest.join(" "),
    mobile: person.mobile_e164,
    email: person.email,
    city,
    pincode: place?.pincode ?? address?.pincode ?? null,
    street: address === null ? null : streetOf(address),
    state: state?.state ?? null,
    stateCode: state?.code ?? null,
  });
}
