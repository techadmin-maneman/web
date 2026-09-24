// A person's contact in FSM: the one the mirror or an earlier booking linked,
// else a new one. FSM holds the city; the street is confirmed with the client.

import type { FsmProvider } from "../providers/fsm.ts";
import { currentAddress } from "./profile.ts";

/** The state each served city is in, with its GST code, for the contact's place of supply. */
const STATES: Readonly<Record<string, { state: string; code: string }>> = {
  Gurgaon: { state: "Haryana", code: "HR" },
  Faridabad: { state: "Haryana", code: "HR" },
  Delhi: { state: "Delhi", code: "DL" },
  Noida: { state: "Uttar Pradesh", code: "UP" },
  Ghaziabad: { state: "Uttar Pradesh", code: "UP" },
};

/**
 * The person's FSM contact ID, adding the contact if they have none. Its city is `city` if given, else their
 * saved address's, else their latest booking's, else the city of the pincode they were invited at. An invited
 * friend's lead names the city of the pincode they gave; where even that is not one of ours, the invite's pincode
 * is the only city we hold until they save an address.
 * The ID is kept at once, so a retry does not add it twice.
 */
export async function fsmContactOf(db: D1Database, fsm: FsmProvider, personId: string, city?: string): Promise<string> {
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

  const where = city ?? (await currentAddress(db, personId))?.city ?? person.lead_city ?? person.invited_city;
  if (where === null) throw new Error("the person has no city to give FSM");
  const [first, ...rest] = person.name.trim().split(/\s+/);
  const place = STATES[where];
  const contactId = await fsm.createContact({
    firstName: rest.length === 0 ? null : (first ?? null),
    lastName: rest.length === 0 ? person.name.trim() : rest.join(" "),
    mobile: person.mobile_e164,
    email: person.email,
    city: where,
    state: place?.state ?? null,
    stateCode: place?.code ?? null,
  });
  await db
    .prepare("UPDATE people SET fsm_contact_id = ?1 WHERE id = ?2 AND fsm_contact_id IS NULL")
    .bind(contactId, personId)
    .run();
  return contactId;
}
