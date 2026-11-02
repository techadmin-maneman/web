// The address a client's visits go to, at the right of their page: its lines, and Edit, which records an address the
// client gave on the phone (./GivenAddress.tsx). Saved, it stands over the one the page read.

import { Panel } from "@maneman/ui/Panel";
import { EmptyState } from "@maneman/ui/EmptyState";
import { classes } from "@maneman/ui/classes";
import { Toast } from "@maneman/ui/Toast";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { TextButton } from "@maneman/ui/TextLink";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { addressLine } from "@maneman/web-kit/address";
import { longDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import type { ClientRecord } from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { whoWords } from "../lib/who.ts";
import styles from "./clients.module.css";
import { GivenAddressForm } from "./GivenAddress.tsx";

type SavedAddress = NonNullable<ClientRecord["address"]>;

const copy = clients.visits;

/** The address under the panel's title, which names it: its line unnamed but read out, then what goes with it. */
function AddressRows({ address }: { address: SavedAddress }) {
  const rows = [
    { key: copy.address, value: addressLine(address), unnamed: true },
    ...(address.landmark === null ? [] : [{ key: copy.landmark, value: address.landmark }]),
    ...(address.access_notes === null ? [] : [{ key: copy.access, value: address.access_notes }]),
    ...(address.given_to_ops === null
      ? []
      : [
          {
            key: copy.givenToOps,
            value: copy.givenTo(whoWords(address.given_to_ops.by), longDate(address.given_to_ops.at)),
          },
        ]),
  ];
  return (
    <dl className={classes(styles.address, styles.asideRows)}>
      {rows.map((row) => (
        <div className={styles.addressRow} key={row.key}>
          {"unnamed" in row ? (
            <dt>
              <VisuallyHidden>{row.key}</VisuallyHidden>
            </dt>
          ) : (
            <dt className={styles.metaKey}>{row.key}</dt>
          )}
          <dd className={styles.addressValue}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VisitAddress({
  clientId,
  address,
  onAddress,
}: {
  clientId: string;
  address: ClientRecord["address"];
  onAddress: (address: SavedAddress) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const mayRecord = useAccess().mayCall("POST /api/clients/{id}/address");

  const stopRecording = () => {
    setRecording(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <Panel
      titleId="visit-address"
      title={copy.address}
      actions={
        mayRecord && (
          <TextButton
            compact
            ref={opener}
            onClick={() => {
              setSaved(false);
              setRecording(true);
            }}
          >
            {address === null ? copy.given.open : copy.given.change}
          </TextButton>
        )
      }
    >
      {recording && (
        <FormDrawer title={copy.given.title} onClose={stopRecording}>
          <GivenAddressForm
            clientId={clientId}
            address={address}
            onSaved={(given) => {
              onAddress(given);
              setSaved(true);
              stopRecording();
            }}
            onCancel={stopRecording}
          />
        </FormDrawer>
      )}
      {address === null ? <EmptyState look="panel" line={copy.noAddress} /> : <AddressRows address={address} />}
      {saved && <Toast>{copy.given.saved}</Toast>}
    </Panel>
  );
}
