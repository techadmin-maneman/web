// The address form, with the building search (docs/decisions/0054-address-capture.md): Profile's "Where we come"
// opens it, and the booking sheet asks for it before any slot when the client has given none
// (docs/decisions/0079-an-address-before-a-slot.md). Its fields follow the account section's number
// field. The fields an address cannot do without say they are required, and one left out is marked, named by the
// error, and given the focus. The API refuses a pincode we do not come to, which offers the waitlist, and a move to
// another city while a visit is booked, which offers a message to ops.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { TextLink } from "@maneman/ui/TextLink";
import { AddressFields } from "@maneman/ui/AddressFields";
import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { given, missingParts, type AddressPart } from "@maneman/web-kit/address";
import { api, type Address } from "../api.ts";
import { BOOKING_URL, messages, profile } from "../content.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { BuildingSearch } from "./BuildingSearch.tsx";
import styles from "./profile.module.css";

/**
 * The draft with a building chosen from the search, or typed over one. An empty ID means the client typed over the
 * choice: the building stands as words, and the address saves without a pin. A chosen building's area replaces the
 * one typed, which may be the old address's: the building is where the pin is.
 */
function withBuilding(
  draft: Address,
  { placeId, building, area }: { placeId: string; building: string; area: string | null },
): Address {
  return {
    ...draft,
    building: building === "" ? null : building,
    locality: area ?? draft.locality,
    place_id: placeId === "" ? null : placeId,
  };
}

const EMPTY: Address = {
  line1: "",
  line2: null,
  locality: "",
  city: "",
  pincode: "",
  access_notes: null,
  building: null,
  flat: null,
  floor: null,
  tower: null,
  landmark: null,
  place_id: null,
};

/** Why the API would not save the address, where the form offers a way on. */
type Refused = "not_served" | "visit_booked";

const ERROR_ID = "address-error";

const ADDRESS_WORDS = {
  labels: { ...profile.form, access_notes: profile.form.accessNotes },
  hints: { access_notes: profile.form.accessHint },
};

/** The site's /book, where a pincode we do not come to joins the waitlist. */
const WAITLIST_URL = BOOKING_URL[import.meta.env.MM_ENV];

export function AddressForm({
  address,
  saveLabel,
  onSaved,
  onCancel,
}: {
  /** The address to change; null for a client who has given none. */
  address: Address | null;
  saveLabel: string;
  onSaved: () => void;
  /** Profile's way back to the address as it was; the booking sheet has its own Close. */
  onCancel?: () => void;
}) {
  const copy = profile;
  const [editing, setEditing] = useState<Address>(address ?? EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<readonly AddressPart[]>([]);
  const [refused, setRefused] = useState<Refused | null>(null);
  // One token for the whole search, made when the form opens: it is what puts
  // Google's autocomplete on the free per-session price rather than per
  // keystroke.
  const [sessionToken] = useState(() => crypto.randomUUID());
  // One save per intent: a second sends the same session token again, and Google bills a second
  // Place Details resolution against a session that was meant to close once.
  const [busy, once] = useOneAtATime();

  const save = (chosenDraft: Address) =>
    once(async () => {
      // A building chosen from the search is the address's first line, so the
      // "Building, society or street" field is not shown and not asked for twice.
      const draft: Address = given(chosenDraft.building)
        ? { ...chosenDraft, line1: chosenDraft.building }
        : chosenDraft;
      const left = missingParts(draft);
      setInvalid(left);
      setRefused(null);
      if (left.length > 0) {
        setProblem(copy.form.invalid);
        document.getElementById(`address-${left[0] ?? ""}`)?.focus();
        return;
      }
      const answer = await api.saveAddress({
        ...draft,
        flat: draft.flat?.trim() ?? "",
        line2: draft.line2?.trim() === "" ? null : draft.line2,
        access_notes: draft.access_notes?.trim() === "" ? null : draft.access_notes,
        session_token: sessionToken,
      });
      if (answer.ok) {
        onSaved();
        return;
      }
      if (answer.code === "not_served") {
        setRefused("not_served");
        setInvalid(["pincode"]);
        setProblem(copy.form.notServed(draft.pincode.trim()));
        document.getElementById("address-pincode")?.focus();
        return;
      }
      if (answer.code === "visit_booked") {
        setRefused("visit_booked");
        setProblem(copy.form.visitBooked);
        return;
      }
      setProblem(copy.change.failed);
    });

  return (
    <form
      className={styles.form}
      noValidate
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void save(editing);
      }}
    >
      <BuildingSearch
        value={editing.building ?? ""}
        sessionToken={sessionToken}
        pincode={editing.pincode}
        onChoose={(chosen) => {
          setEditing((draft) => withBuilding(draft, chosen));
        }}
        onClear={() => {
          setEditing((draft) => ({ ...draft, place_id: null }));
        }}
      />
      {/* A building chosen from the search is line one, so line one is asked only where none was. */}
      <AddressFields
        idPrefix="address"
        valueOf={(part) => editing[part] ?? ""}
        without={given(editing.building) ? ["line1"] : []}
        marked={invalid}
        describedBy={ERROR_ID}
        onChange={(part, value) => {
          setEditing((draft) => ({ ...draft, [part]: value }));
        }}
        words={ADDRESS_WORDS}
        fieldClassName={styles.formField}
      />
      {problem !== null && (
        <InlineMessage tone="error" className={styles.error} id={ERROR_ID}>
          {problem}
        </InlineMessage>
      )}
      {refused === "not_served" && (
        <TextLink className={styles.link} href={WAITLIST_URL}>
          {copy.form.waitlist}
        </TextLink>
      )}
      {refused === "visit_booked" && (
        <TextLink className={styles.link} href={whatsappWith(messages.moveCity)}>
          {copy.form.message}
        </TextLink>
      )}
      <div className={styles.row}>
        <Button variant="primary" size="control" className={styles.primary} type="submit" disabled={busy}>
          {saveLabel}
        </Button>
        {onCancel !== undefined && (
          <Button variant="quiet" size="control" className={styles.secondary} onClick={onCancel}>
            {copy.form.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
