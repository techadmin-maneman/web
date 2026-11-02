// Partners who send us clients on their own code (docs/decisions/0123-partner-referral-channels.md): each with its
// link, what its friend gets, its commission per fit, and what has come through it. A row opens its record beside the
// list, where each term changes where it reads (docs/decisions/0212-editing-in-place.md).

import { EmptyState } from "@maneman/ui/EmptyState";
import { Toast } from "@maneman/ui/Toast";
import { PageActions } from "../frame/PageHead.tsx";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { type Partner, type Partners as PartnerList } from "../api.ts";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { BOOKING_URL } from "../content/common.ts";
import { partners as copy } from "../content/partners.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
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

const heads = copy.columns;

/** Every column sorts; a partner paused or not narrows the list. */
const COLUMNS: readonly Column<Partner>[] = [
  { label: heads.name, sort: (row) => row.name },
  { label: heads.link, sort: (row) => row.code },
  { label: heads.friend, sort: (row) => row.friend_visits },
  { label: heads.commission, sort: (row) => row.commission, figure: true },
  { label: heads.opens, sort: (row) => row.opens, figure: true },
  { label: heads.referred, sort: (row) => row.referred, figure: true },
  { label: heads.fitted, sort: (row) => row.fitted, figure: true },
  { label: heads.earned, sort: (row) => row.earned, figure: true },
  { label: heads.owed, sort: (row) => row.owed, figure: true },
];

function PartnerTable({ list, onOpen }: { list: PartnerList; onOpen: (id: string) => void }) {
  const view = useTableView(list.channels, COLUMNS, {
    search: (row) => `${row.name} ${row.code} ${row.discount_code ?? ""}`,
  });
  return (
    <>
      <Narrowing view={view} label={copy.find} />
      <TableScroll labelledBy="partners">
        <Table className={styles.table}>
          <thead>
            <tr>
              <SortHeads view={view} />
            </tr>
          </thead>
          <tbody>
            {view.shown.map((partner) => (
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
      <TableEnd view={view} />
    </>
  );
}

export function Partners() {
  const [loaded, retry] = useLoad(referralsApi.partners);
  /** The list as the last change left it, so the panel follows a change without reading it again. */
  const [changed, setChanged] = useState<PartnerList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayAdd = useAccess().mayCall("POST /api/referral-channels");
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const list = changed ?? loaded.value;
  const opened = list.channels.find((each) => each.id === open);
  return (
    <>
      <PageActions>
        {mayAdd && (
          <DrawerButton primary label={copy.add} title={copy.form.addTitle}>
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
        )}
      </PageActions>
      <Panel titleId="partners" title={copy.title}>
        {said !== null && <Toast>{said}</Toast>}
        {list.channels.length === 0 ? (
          <EmptyState look="panel" line={copy.none} />
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
    </>
  );
}
