// A technician's Kit tab: what their kit holds of each consumable, as the stock ledger counts it, each with the state
// Stock gives it by the same rule (../stock/stock-state.tsx). Movements are recorded in Stock, which the tab links to.

import { Note } from "@maneman/ui/Note";
import { NoValue } from "@maneman/ui/NoValue";
import { Panel } from "@maneman/ui/Panel";
import { StateBadge, stateOf } from "../stock/index.ts";
import { buttonLook } from "@maneman/ui/Button";
import { FIGURE, Table } from "@maneman/ui/Table";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { api, type Stock, type TechnicianSummary } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
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

  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />;

  const kitStock = loaded.value;
  const held = kitStock.holdings.filter((holding) => holding.place_id === technician.id);
  return (
    <Panel
      titleId="technician-kit"
      title={copy.title}
      actions={
        <OpsLink className={buttonLook({ variant: "outline", size: "small" })} to="/stock">
          {copy.stock}
        </OpsLink>
      }
    >
      {held.length === 0 ? (
        <Note>{copy.none}</Note>
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
