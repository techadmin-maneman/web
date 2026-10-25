// Partners who send us clients on their own code (docs/decisions/0123-partner-referral-channels.md): each with its
// link, what its friend gets, its commission per fit, and what has come through it. A row opens its record beside the
// list, where each term changes where it reads (docs/decisions/0212-editing-in-place.md).

import { Toast } from "@maneman/ui/Toast";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { type Partner, type Partners as PartnerList } from "../api.ts";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { BOOKING_URL } from "../content/common.ts";
import { partners as copy } from "../content/partners.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { AddPartner } from "./PartnerForm.tsx";
import { PartnerRecord } from "./PartnerRecord.tsx";
import styles from "./partners.module.css";
import { referralsApi } from "./referrals-api.ts";

/** The site the partner's link opens: the environment's own. */
const SITE = new URL(BOOKING_URL[import.meta.env.MM_ENV]);

function PartnerRow({ partner, onOpen }: { partner: Partner; onOpen: () => void }) {
  return (
    <tr>
      <th scope="row" className={styles.name}>
        <TextButton compact aria-label={copy.open(partner.name)} onClick={onOpen}>
          {partner.name}
        </TextButton>
        {partner.paused_at !== null && <span className={styles.paused}> · {copy.paused}</span>}
      </th>
      <td>
        <TextLink href={`${SITE.origin}/r/${partner.code}`} newTab>
          {copy.link(SITE.host, partner.code)}
        </TextLink>
      </td>
      <td>
        {copy.friendGets(partner.friend_visits, partner.valid_days)}
        {partner.discount_code !== null && <span className={styles.code}>{partner.discount_code}</span>}
      </td>
      <td className={styles.figure}>{rupees(partner.commission)}</td>
      <td className={styles.figure}>{partner.opens}</td>
      <td className={styles.figure}>{partner.referred}</td>
      <td className={styles.figure}>{partner.fitted}</td>
      <td className={styles.figure}>{rupees(partner.earned)}</td>
      <td className={styles.figure}>{rupees(partner.owed)}</td>
    </tr>
  );
}

function PartnerTable({ list, onOpen }: { list: PartnerList; onOpen: (id: string) => void }) {
  const heads = copy.columns;
  const figures = [heads.commission, heads.opens, heads.referred, heads.fitted, heads.earned, heads.owed];
  return (
    <TableScroll labelledBy="partners">
      <Table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{heads.name}</th>
            <th scope="col">{heads.link}</th>
            <th scope="col">{heads.friend}</th>
            {figures.map((label) => (
              <th key={label} scope="col" className={styles.figure}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.channels.map((partner) => (
            <PartnerRow
              key={partner.id}
              partner={partner}
              onOpen={() => {
                onOpen(partner.id);
              }}
            />
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

export function Partners() {
  const [loaded, retry] = useLoad(referralsApi.partners);
  /** The list as the last change left it, so the panel follows a change without reading it again. */
  const [changed, setChanged] = useState<PartnerList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayAdd = useAccess().mayCall("POST /api/referral-channels");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const list = changed ?? loaded.value;
  const opened = list.channels.find((each) => each.id === open);
  return (
    <Panel
      titleId="partners"
      title={copy.title}
      padded
      actions={
        mayAdd && (
          <DrawerButton label={copy.add} title={copy.form.addTitle}>
            {(close) => (
              <AddPartner
                limits={list.limits}
                onAdded={(next) => {
                  setChanged(next);
                  setSaid(copy.added);
                  close();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        )
      }
    >
      {said !== null && <Toast>{said}</Toast>}
      {list.channels.length === 0 ? (
        <Note>{copy.none}</Note>
      ) : (
        <PartnerTable
          list={list}
          onOpen={(id) => {
            setOpen(id);
            setSaid(null);
          }}
        />
      )}
      {opened !== undefined && (
        <FormDrawer
          title={opened.name}
          onClose={() => {
            setOpen(null);
          }}
        >
          <PartnerRecord partner={opened} list={list} site={SITE} onSaved={setChanged} />
        </FormDrawer>
      )}
    </Panel>
  );
}
