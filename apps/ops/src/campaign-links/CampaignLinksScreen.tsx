// Growth · Campaign links (docs/decisions/0288-attribution-and-conversions.md, docs/tracking.md): each society
// activation's and offer's link, its code and discount, what was spent on it and what came through it; its link to
// copy and its QR code to print, as SVG or PNG; a new one of either kind; and retiring one.

import { DeleteAction } from "@maneman/ui/DeleteAction";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { RowButton } from "@maneman/ui/Button";
import { EmptyState } from "@maneman/ui/EmptyState";
import { NoValue } from "@maneman/ui/NoValue";
import { Panel } from "@maneman/ui/Panel";
import { RowHead } from "@maneman/ui/RowHead";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { ACTIONS, FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { Toast } from "@maneman/ui/Toast";
import { useLoad } from "@maneman/ui/useLoad";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { indiaDate, listDate, yearInIndia } from "@maneman/web-kit/dates";
import { apiNow } from "@maneman/web-kit/clock";
import { quantity } from "@maneman/web-kit/figures";
import { rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { renderSVG } from "uqr";
import form from "@maneman/ui/forms.module.css";
import { campaignLinks as copy } from "../content/campaign-links.ts";
import { PageActions } from "../frame/PageHead.tsx";
import { useAccess } from "../lib/access.ts";
import { saveFile, saveSvgAsPng } from "../lib/save-file.ts";
import { campaignLinksApi, type CampaignLink, type CampaignLinks } from "./campaign-links-api.ts";
import { OfferForm, SocietyForm } from "./CampaignLinkForms.tsx";

/** A link's QR code: black on white with the quiet border the standard asks for, readable through a scuffed print. */
const qrOf = (link: CampaignLink) => renderSVG(link.short_link, { ecc: "M", border: 4 });

/** The PNG's side, large enough for a standee. */
const PNG_SIZE = 1200;

const madeOn = (link: CampaignLink) => listDate(indiaDate(link.created_at), yearInIndia(apiNow()));

const COLUMNS: readonly Column<CampaignLink>[] = [
  { label: copy.columns.name, sort: (link) => link.name },
  { label: copy.columns.kind, sort: (link) => link.kind, choice: (link) => copy.kinds[link.kind] },
  { label: copy.columns.link, sort: (link) => link.short_link },
  { label: copy.columns.code, sort: (link) => link.code },
  { label: copy.columns.discount, sort: (link) => link.discount_code ?? "" },
  { label: copy.columns.spent, sort: (link) => link.spent, figure: true },
  { label: copy.columns.touches, sort: (link) => link.touches, figure: true },
  { label: copy.columns.people, sort: (link) => link.people, figure: true },
  { label: copy.columns.made, sort: (link) => link.created_at },
];

function LinkActions(props: { link: CampaignLink; mayRetire: boolean; onRetired: () => void; onCopied: () => void }) {
  const { link } = props;
  return (
    <td className={ACTIONS}>
      <RowButton
        aria-label={copy.copyLabel(link.name)}
        onClick={() => {
          void navigator.clipboard.writeText(link.short_link).then(props.onCopied);
        }}
      >
        {copy.copy}
      </RowButton>
      <RowButton
        beside
        aria-label={copy.qrLabel(link.name, "SVG")}
        onClick={() => {
          saveFile(copy.qrName(link.slug, "svg"), qrOf(link), "image/svg+xml");
        }}
      >
        {copy.qrSvg}
      </RowButton>
      <RowButton
        beside
        aria-label={copy.qrLabel(link.name, "PNG")}
        onClick={() => {
          void saveSvgAsPng(copy.qrName(link.slug, "png"), qrOf(link), PNG_SIZE);
        }}
      >
        {copy.qrPng}
      </RowButton>
      {props.mayRetire && link.retired_at === null && (
        <DeleteAction
          name={link.name}
          tone="danger"
          words={copy.retiring}
          send={() => campaignLinksApi.retire(link.id)}
          refusal={(code) => errorText(copy.errors, { code })}
          onDeleted={props.onRetired}
        />
      )}
    </td>
  );
}

function LinksTable(props: { links: readonly CampaignLink[]; mayRetire: boolean; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const view = useTableView(props.links, COLUMNS, {
    search: (link) => `${link.name} ${link.code} ${link.utm_campaign}`,
  });
  if (props.links.length === 0) return <EmptyState look="panel" line={copy.none} />;
  return (
    <>
      {copied && <Toast>{copy.copied}</Toast>}
      <Narrowing view={view} label={copy.find} />
      <TableScroll labelledBy="campaign-links">
        <Table>
          <thead>
            <tr>
              <SortHeads view={view} />
              <th scope="col" className={ACTIONS} />
            </tr>
          </thead>
          <tbody>
            {view.shown.map((link) => (
              <tr key={link.id}>
                <RowHead>{link.retired_at === null ? link.name : `${link.name} · ${copy.retired}`}</RowHead>
                <td>{copy.kinds[link.kind]}</td>
                <td>{link.short_link}</td>
                <td>{link.code}</td>
                <td>{link.discount_code ?? <NoValue />}</td>
                <td className={FIGURE}>{rupees(link.spent)}</td>
                <td className={FIGURE}>{quantity(link.touches)}</td>
                <td className={FIGURE}>{quantity(link.people)}</td>
                <td>{madeOn(link)}</td>
                <LinkActions
                  link={link}
                  mayRetire={props.mayRetire}
                  onRetired={props.onChanged}
                  onCopied={() => {
                    setCopied(true);
                  }}
                />
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <TableEnd view={view} />
    </>
  );
}

function Making({ list, onMade }: { list: CampaignLinks; onMade: () => void }) {
  return (
    <PageActions>
      <DrawerButton primary label={copy.newSociety}>
        {(close) => (
          <SocietyForm
            list={list}
            onMade={() => {
              close();
              onMade();
            }}
            onCancel={close}
          />
        )}
      </DrawerButton>
      <DrawerButton label={copy.newOffer}>
        {(close) => (
          <OfferForm
            list={list}
            onMade={() => {
              close();
              onMade();
            }}
            onCancel={close}
          />
        )}
      </DrawerButton>
    </PageActions>
  );
}

export function CampaignLinksScreen() {
  const [loaded, retry] = useLoad(campaignLinksApi.list);
  const access = useAccess();
  return (
    <div className={form.screen}>
      {loaded.state === "loaded" && access.mayCall("POST /api/campaign-links") && (
        <Making list={loaded.value} onMade={retry} />
      )}
      <Panel titleId="campaign-links" title={copy.title}>
        {loaded.state === "loading" && <PanelLoading />}
        {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
        {loaded.state === "loaded" && (
          <LinksTable
            links={loaded.value.links}
            mayRetire={access.mayCall("POST /api/campaign-links/{id}/retire")}
            onChanged={retry}
          />
        )}
      </Panel>
    </div>
  );
}
