// A technician's Kit tab: what his kit holds of each consumable, as the stock ledger counts it, with the same Low
// mark the Stock section gives it. Movements are recorded in Stock, which the tab links to.

import { buttonLook } from "@maneman/ui/Button";
import { FIGURE, Table } from "@maneman/ui/Table";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { api, type Stock, type TechnicianSummary } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { stock, technicians } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./technicians.module.css";

const copy = technicians.kit;

type Holding = Stock["holdings"][number];

function KitRow({ book, holding }: { book: Stock; holding: Holding }) {
  const consumable = book.consumables.find((each) => each.code === holding.consumable_code);
  const counted = holding.counted_at === null ? technicians.unknown : shortDate(indiaDate(holding.counted_at));
  return (
    <tr>
      <th scope="row">{consumable?.name ?? holding.consumable_code}</th>
      <td className={FIGURE}>
        <span className={holding.quantity < 0 ? styles.over : undefined}>
          {stock.held(holding.quantity, consumable?.unit ?? "")}
        </span>
        {holding.low && <span className={styles.low}>{stock.low}</span>}
      </td>
      <td className={styles.counted}>{counted}</td>
    </tr>
  );
}

export function Kit({ technician }: { technician: TechnicianSummary }) {
  const [loaded, retry] = useLoad(api.stock);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />;

  const book = loaded.value;
  const held = book.holdings.filter((holding) => holding.technician_id === technician.id);
  return (
    <>
      <p className={styles.lead}>{copy.lead}</p>
      {held.length === 0 ? (
        <p className={styles.none}>{copy.none}</p>
      ) : (
        <Table className={styles.kit}>
          <thead>
            <tr>
              {copy.columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {held.map((holding) => (
              <KitRow key={holding.consumable_code} book={book} holding={holding} />
            ))}
          </tbody>
        </Table>
      )}
      <div className={styles.actions}>
        <OpsLink className={buttonLook({ variant: "outline", size: "small", className: styles.quiet })} to="/stock">
          {copy.stock}
        </OpsLink>
      </div>
    </>
  );
}
