// A consultation's Options, the first page of its outcome (docs/decisions/0247-the-steps-left.md): each product on sale
// that day with what it costs the client, incl. GST, and the one they pick, which goes with the close of a client going
// ahead. The products are the card's, so a pick is made with no signal; their prices and the client's looks need it.

import { Button } from "@maneman/ui/Button";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useLoad } from "@maneman/ui/useLoad";
import { dayMonth } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback } from "react";
import { api, type Job, type Options } from "../api.ts";
import { options as copy } from "../content.ts";
import shared from "./steps.module.css";
import styles from "./options-pick.module.css";

type Package = Options["packages"][number];

const priceOf = (price: Package["service"]) => (price === null ? copy.noPrice : rupees(price.amount));

/** A package's prices: its first fit, always priced where it is on sale, then its service visit and replacement. */
function Prices({ option }: { option: Package }) {
  const rows = [
    [copy.firstFit, priceOf(option.first_fit)],
    [copy.service(option.service_every_days), priceOf(option.service)],
    [copy.replacement(option.replace_after_months), priceOf(option.replacement)],
  ];
  return (
    <dl className={styles.prices}>
      {rows.map(([term, value]) => (
        <div key={term} className={styles.price}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Looks({ looks }: { looks: Options["looks"] }) {
  return (
    <section className={shared.field} aria-labelledby="looks-title">
      <h2 className={styles.head} id="looks-title">
        {copy.looksTitle}
      </h2>
      <div className={styles.looks}>
        {looks.map((look) => (
          <img key={look.id} className={styles.look} src={look.url} alt={copy.look(dayMonth(look.made_on))} />
        ))}
      </div>
    </section>
  );
}

export function OptionsPick({
  job,
  picked,
  onPick,
}: {
  job: Job;
  picked: string | null;
  onPick: (tier: string) => void;
}) {
  const read = useCallback(() => api.options(job.id), [job.id]);
  const [loaded, retry] = useLoad(read);
  const priced = new Map(loaded.state === "loaded" ? loaded.value.packages.map((one) => [one.code, one]) : []);
  return (
    <>
      <section className={shared.field} aria-labelledby="prices-title">
        <h2 className={styles.head} id="prices-title">
          <span>{copy.prices}</span>
          <span>{copy.inclGst}</span>
        </h2>
        <p className={styles.quiet}>{job.products.length === 0 ? copy.none : copy.markPick}</p>
        <ul className={styles.list} role="radiogroup" aria-labelledby="prices-title">
          {job.products.map((product) => {
            const option = priced.get(product.tier);
            return (
              <li key={product.tier}>
                <ToggleButton
                  className={styles.pick}
                  asRadio
                  pressed={picked === product.tier}
                  onClick={() => {
                    onPick(product.tier);
                  }}
                >
                  <span className={styles.name}>{product.name}</span>
                  {typeof option?.description === "string" && <span className={styles.line}>{option.description}</span>}
                </ToggleButton>
                {option !== undefined && <Prices option={option} />}
              </li>
            );
          })}
        </ul>
        {loaded.state === "failed" && (
          <div className={styles.failed}>
            <p className={styles.quiet}>{copy.pricesFailed}</p>
            <Button variant="outline" size="control" onClick={retry}>
              {copy.retry}
            </Button>
          </div>
        )}
      </section>
      {loaded.state === "loaded" && loaded.value.looks.length > 0 && <Looks looks={loaded.value.looks} />}
    </>
  );
}
