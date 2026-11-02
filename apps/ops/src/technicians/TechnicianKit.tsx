// A technician's Kit tab: what their kit holds of each consumable, as the stock ledger counts it, each with the state
// Stock gives it by the same rule (../stock/stock-state.tsx). A movement is recorded here, in the drawer Stock opens,
// starting at their kit. A job's use comes out of the kit as the technician records it on their phone.

import { EmptyState } from "@maneman/ui/EmptyState";
import { NoValue } from "@maneman/ui/NoValue";
import { Panel } from "@maneman/ui/Panel";
import { RecordMovement, StateBadge, stateOf } from "../stock/index.ts";
import { FIGURE, Table } from "@maneman/ui/Table";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { api, type Stock, type TechnicianSummary } from "../api.ts";
import { PageActions } from "../frame/PageHead.tsx";
import { useState } from "react";
import { technicians } from "../content.ts";
import { stock } from "../content/stock.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import styles from "./technician-kit.module.css";

const copy = technicians.kit;

type Holding = Stock["holdings"][number];

function KitRow({ kitStock, holding, place }: { kitStock: Stock; holding: Holding; place: string }) {
  const consumable = kitStock.consumables.find((each) => each.code === holding.consumable_code);
  return (
    <tr>
      <th scope="row">{consumable?.name ?? holding.consumable_code}</th>
      <td className={FIGURE}>{stock.held(holding.quantity, consumable?.unit ?? "")}</td>
      <td>{consumable !== undefined && <StateBadge state={stateOf(kitStock, consumable, place)} />}</td>
      <td>{holding.counted_at === null ? <NoValue /> : shortDate(indiaDate(holding.counted_at))}</td>
    </tr>
  );
}

export function Kit({ technician }: { technician: TechnicianSummary }) {
  const [loaded, retry] = useLoad(api.stock);
  /** The stock as the last movement left it, so the kit follows without reading it again. */
  const [after, setAfter] = useState<Stock | null>(null);

  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />;

  const kitStock = after ?? loaded.value;
  const held = kitStock.holdings.filter((holding) => holding.place_id === technician.id);
  return (
    <Panel titleId="technician-kit" title={copy.title}>
      <PageActions>
        <RecordMovement
          stock={kitStock}
          at={technician.id}
          onRecorded={(next) => {
            setAfter(next);
          }}
        />
      </PageActions>
      {held.length === 0 ? (
        <EmptyState look="panel" line={copy.none} />
      ) : (
        <Table fixed className={styles.kit}>
          <thead>
            <tr>
              <th scope="col">{copy.columns.item}</th>
              <th scope="col" className={FIGURE}>
                {copy.columns.held}
              </th>
              <th scope="col">{copy.columns.status}</th>
              <th scope="col">{copy.columns.counted}</th>
            </tr>
          </thead>
          <tbody>
            {held.map((holding) => (
              <KitRow key={holding.consumable_code} kitStock={kitStock} holding={holding} place={technician.id} />
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
